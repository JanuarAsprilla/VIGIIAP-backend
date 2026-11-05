import { describe, it, expect, vi, beforeEach } from 'vitest';
import jwt from 'jsonwebtoken';

vi.mock('../src/config/database.js', () => ({
  query: vi.fn().mockResolvedValue({ rows: [] }),
  getClient: vi.fn(),
}));

vi.mock('../src/modules/auth/twoFactor.service.js', () => ({
  setupTotp:          vi.fn(),
  enableTotp:         vi.fn(),
  disableTotp:        vi.fn(),
  verifyTotpOrBackup: vi.fn(),
}));

vi.mock('../src/modules/auth/auth.service.js', () => ({
  issueTokenPair:         vi.fn(),
  revokeAllRefreshTokens: vi.fn(),
}));

vi.mock('../src/modules/auth/twoFactorBloqueo.js', () => ({
  reservarIntentoSegundoFactor: vi.fn().mockResolvedValue({ bloqueaAhora: false }),
  limpiarFallosSegundoFactor:   vi.fn().mockResolvedValue(undefined),
}));

vi.mock('qrcode', () => ({
  default: { toDataURL: vi.fn().mockResolvedValue('data:image/png;base64,FAKE_QR') },
}));

vi.mock('../src/utils/logger.js', () => ({
  default: { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() },
}));

import { query } from '../src/config/database.js';
import * as tfService from '../src/modules/auth/twoFactor.service.js';
import { issueTokenPair } from '../src/modules/auth/auth.service.js';
import { reservarIntentoSegundoFactor, limpiarFallosSegundoFactor } from '../src/modules/auth/twoFactorBloqueo.js';
import { setup, verify, disable, confirm } from '../src/modules/auth/twoFactor.controller.js';

process.env.JWT_SECRET = 'test-secret-2fa-ctrl';

function mockRes() {
  return {
    status:      vi.fn().mockReturnThis(),
    json:        vi.fn().mockReturnThis(),
    cookie:      vi.fn().mockReturnThis(),
    clearCookie: vi.fn().mockReturnThis(),
  };
}
const mockNext = vi.fn();

const USER = { id: 'user-uuid', email: 'user@iiap.org.co', rol: 'investigador' };

function make2faToken(payload = { id: USER.id, scope: '2fa' }) {
  return jwt.sign(payload, process.env.JWT_SECRET, { algorithm: 'HS256', expiresIn: '5m' });
}

// ─── setup() ─────────────────────────────────────────────────────────────────

describe('setup()', () => {
  beforeEach(() => vi.clearAllMocks());

  it('retorna secret y qrDataUrl', async () => {
    tfService.setupTotp.mockResolvedValueOnce({
      secret: 'BASE32SECRET',
      otpauthUrl: 'otpauth://totp/VIGIIAP:user@iiap.org.co?secret=BASE32SECRET',
    });

    const req = { user: USER };
    const res = mockRes();
    await setup(req, res, mockNext);

    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ secret: 'BASE32SECRET', qrDataUrl: expect.stringContaining('data:image') })
    );
    expect(mockNext).not.toHaveBeenCalled();
  });

  it('llama next(err) si setupTotp lanza', async () => {
    tfService.setupTotp.mockRejectedValueOnce(Object.assign(new Error('2FA ya activo'), { status: 409 }));

    const req = { user: USER };
    const res = mockRes();
    await setup(req, res, mockNext);
    expect(mockNext).toHaveBeenCalledWith(expect.any(Error));
  });
});

// ─── verify() ────────────────────────────────────────────────────────────────

describe('verify()', () => {
  beforeEach(() => vi.clearAllMocks());

  it('retorna 400 si no se envía code', async () => {
    const req = { user: USER, body: {} };
    const res = mockRes();
    await verify(req, res, mockNext);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ error: expect.stringContaining('TOTP') }));
  });

  it('activa 2FA y retorna backup codes', async () => {
    tfService.enableTotp.mockResolvedValueOnce({ backupCodes: ['code1', 'code2'] });

    const req = { user: USER, body: { code: '123456' } };
    const res = mockRes();
    await verify(req, res, mockNext);

    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        message: expect.stringContaining('activado'),
        backupCodes: ['code1', 'code2'],
      })
    );
  });

  it('llama next(err) si enableTotp lanza', async () => {
    tfService.enableTotp.mockRejectedValueOnce(Object.assign(new Error('Código inválido'), { status: 401 }));

    const req = { user: USER, body: { code: '000000' } };
    const res = mockRes();
    await verify(req, res, mockNext);
    expect(mockNext).toHaveBeenCalledWith(expect.any(Error));
  });
});

// ─── disable() ───────────────────────────────────────────────────────────────

describe('disable()', () => {
  beforeEach(() => vi.clearAllMocks());

  it('retorna 400 si no se envía code', async () => {
    const req = { user: USER, body: {} };
    const res = mockRes();
    await disable(req, res, mockNext);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('desactiva 2FA y responde con mensaje', async () => {
    tfService.disableTotp.mockResolvedValueOnce(undefined);

    const req = { user: USER, body: { code: '654321' } };
    const res = mockRes();
    await disable(req, res, mockNext);

    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ message: expect.stringContaining('desactivado') })
    );
  });

  it('una cuenta bloqueada no llega a probar el código ni desactiva el 2FA', async () => {
    const err = Object.assign(new Error('bloqueada'), { status: 429, code: 'ACCOUNT_LOCKED' });
    reservarIntentoSegundoFactor.mockRejectedValueOnce(err);
    const next = vi.fn();
    await disable({ user: USER, body: { code: '654321' } }, mockRes(), next);
    expect(next).toHaveBeenCalledWith(err);
    expect(tfService.disableTotp).not.toHaveBeenCalled();
  });

  it('un código correcto limpia el contador de intentos', async () => {
    tfService.disableTotp.mockResolvedValueOnce(undefined);
    await disable({ user: USER, body: { code: '654321' } }, mockRes(), mockNext);
    expect(limpiarFallosSegundoFactor).toHaveBeenCalledWith(USER.id);
  });

  it('llama next(err) si disableTotp lanza', async () => {
    tfService.disableTotp.mockRejectedValueOnce(Object.assign(new Error('Código inválido'), { status: 401 }));

    const req = { user: USER, body: { code: '000000' } };
    const res = mockRes();
    await disable(req, res, mockNext);
    expect(mockNext).toHaveBeenCalledWith(expect.any(Error));
  });
});

// ─── confirm() ───────────────────────────────────────────────────────────────

describe('confirm()', () => {
  beforeEach(() => vi.clearAllMocks());

  it('retorna 401 si no hay cookie vigiiap_2fa_temp', async () => {
    const req = { cookies: {}, body: { code: '123456' }, ip: '127.0.0.1', headers: {} };
    const res = mockRes();
    await confirm(req, res, mockNext);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ error: expect.stringContaining('Token 2FA') }));
  });

  it('retorna 401 si el token es inválido', async () => {
    const req = { cookies: { vigiiap_2fa_temp: 'not-a-valid-jwt' }, body: {}, ip: '127.0.0.1', headers: {} };
    const res = mockRes();
    await confirm(req, res, mockNext);
    expect(res.status).toHaveBeenCalledWith(401);
  });

  it('retorna 401 si el token tiene scope incorrecto', async () => {
    const token = jwt.sign({ id: USER.id, scope: 'wrong' }, process.env.JWT_SECRET, { algorithm: 'HS256', expiresIn: '5m' });
    const req = { cookies: { vigiiap_2fa_temp: token }, body: { code: '123456' }, ip: '127.0.0.1', headers: {} };
    const res = mockRes();
    await confirm(req, res, mockNext);
    expect(res.status).toHaveBeenCalledWith(401);
  });

  it('retorna 400 si no se envía code', async () => {
    const token = make2faToken();
    const req = { cookies: { vigiiap_2fa_temp: token }, body: {}, ip: '127.0.0.1', headers: {} };
    const res = mockRes();
    await confirm(req, res, mockNext);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ error: expect.stringContaining('TOTP') }));
  });

  it('completa el login 2FA y emite tokens', async () => {
    const token = make2faToken();
    tfService.verifyTotpOrBackup.mockResolvedValueOnce(true);
    query.mockResolvedValueOnce({ rows: [USER] }); // SELECT usuario
    issueTokenPair.mockResolvedValueOnce({ accessToken: 'acc', refreshToken: 'ref' });

    const req = {
      cookies: { vigiiap_2fa_temp: token },
      body: { code: '123456' },
      ip: '127.0.0.1',
      headers: { 'user-agent': 'Test/1.0' },
    };
    const res = mockRes();
    await confirm(req, res, mockNext);

    expect(res.clearCookie).toHaveBeenCalledWith('vigiiap_2fa_temp', expect.any(Object));
    expect(res.cookie).toHaveBeenCalledTimes(2);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ token: 'acc', user: expect.objectContaining({ id: USER.id }) })
    );
  });

  it('el user devuelto incluye avatar_url, institucion y twoFactorEnabled — mismo shape que /auth/me', async () => {
    const token = make2faToken();
    const fullUser = {
      ...USER,
      institucion: 'IIAP', tipo_acceso: 'institucional',
      avatar_url: 'https://files.test.local/avatars/x.jpg', totp_enabled: true,
    };
    tfService.verifyTotpOrBackup.mockResolvedValueOnce(true);
    query.mockResolvedValueOnce({ rows: [fullUser] });
    issueTokenPair.mockResolvedValueOnce({ accessToken: 'acc', refreshToken: 'ref' });

    const req = {
      cookies: { vigiiap_2fa_temp: token },
      body: { code: '123456' },
      ip: '127.0.0.1',
      headers: { 'user-agent': 'Test/1.0' },
    };
    const res = mockRes();
    await confirm(req, res, mockNext);

    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        user: expect.objectContaining({
          institucion: 'IIAP',
          tipo_acceso: 'institucional',
          avatar_url: 'https://files.test.local/avatars/x.jpg',
          twoFactorEnabled: true,
        }),
      })
    );
  });

  it('llama next(err) si verifyTotpOrBackup lanza', async () => {
    const token = make2faToken();
    tfService.verifyTotpOrBackup.mockRejectedValueOnce(Object.assign(new Error('Código inválido'), { status: 401 }));

    const req = {
      cookies: { vigiiap_2fa_temp: token },
      body: { code: '000000' },
      ip: '127.0.0.1',
      headers: {},
    };
    const res = mockRes();
    await confirm(req, res, mockNext);
    expect(mockNext).toHaveBeenCalledWith(expect.any(Error));
  });
});

describe('confirm() — bloqueo por cuenta del segundo factor', () => {
  const pedir = () => ({ cookies: { vigiiap_2fa_temp: make2faToken() }, body: { code: '123456' }, ip: '1.1.1.1', headers: {} });
  beforeEach(() => {
    vi.clearAllMocks();
    reservarIntentoSegundoFactor.mockResolvedValue({ bloqueaAhora: false });
  });

  it('una cuenta bloqueada o desactivada no llega a probar el código', async () => {
    const err = Object.assign(new Error('bloqueada'), { status: 429, code: 'ACCOUNT_LOCKED' });
    reservarIntentoSegundoFactor.mockRejectedValueOnce(err);
    const next = vi.fn();
    await confirm(pedir(), mockRes(), next);
    expect(next).toHaveBeenCalledWith(err);
    expect(tfService.verifyTotpOrBackup).not.toHaveBeenCalled();
  });

  it('el intento se reserva ANTES de verificar el código', async () => {
    const orden = [];
    reservarIntentoSegundoFactor.mockImplementationOnce(async () => { orden.push('reserva'); return { bloqueaAhora: false }; });
    tfService.verifyTotpOrBackup.mockImplementationOnce(async () => { orden.push('verifica'); return true; });
    vi.mocked(query).mockResolvedValueOnce({ rows: [{ id: 'user-uuid', nombre: 'U', email: 'u@x.co', rol: 'investigador', totp_enabled: true }] });
    issueTokenPair.mockResolvedValueOnce({ accessToken: 'a', refreshToken: 'r' });
    await confirm(pedir(), mockRes(), vi.fn());
    expect(orden).toEqual(['reserva', 'verifica']);
  });

  it('un código incorrecto responde 401 y no emite sesión', async () => {
    const err = Object.assign(new Error('inválido'), { status: 401 });
    tfService.verifyTotpOrBackup.mockRejectedValueOnce(err);
    const next = vi.fn();
    await confirm(pedir(), mockRes(), next);
    expect(next).toHaveBeenCalledWith(err);
    expect(issueTokenPair).not.toHaveBeenCalled();
    expect(limpiarFallosSegundoFactor).not.toHaveBeenCalled();
  });

  it('si el intento fallido agota el cupo responde 429, borra el token temporal y no emite sesión', async () => {
    reservarIntentoSegundoFactor.mockResolvedValueOnce({ bloqueaAhora: true });
    tfService.verifyTotpOrBackup.mockRejectedValueOnce(Object.assign(new Error('inválido'), { status: 401 }));
    const res = mockRes();
    await confirm(pedir(), res, vi.fn());
    expect(res.status).toHaveBeenCalledWith(429);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ code: 'ACCOUNT_LOCKED' }));
    expect(res.clearCookie).toHaveBeenCalledWith('vigiiap_2fa_temp', expect.anything());
    expect(issueTokenPair).not.toHaveBeenCalled();
  });

  it('un código correcto limpia el contador', async () => {
    tfService.verifyTotpOrBackup.mockResolvedValueOnce(true);
    vi.mocked(query).mockResolvedValueOnce({ rows: [{ id: 'user-uuid', nombre: 'U', email: 'u@x.co', rol: 'investigador', totp_enabled: true }] });
    issueTokenPair.mockResolvedValueOnce({ accessToken: 'a', refreshToken: 'r' });
    await confirm(pedir(), mockRes(), vi.fn());
    expect(limpiarFallosSegundoFactor).toHaveBeenCalledWith('user-uuid');
  });
});
