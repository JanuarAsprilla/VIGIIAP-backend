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

vi.mock('qrcode', () => ({
  default: { toDataURL: vi.fn().mockResolvedValue('data:image/png;base64,FAKE_QR') },
}));

vi.mock('../src/utils/logger.js', () => ({
  default: { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() },
}));

import { query } from '../src/config/database.js';
import * as tfService from '../src/modules/auth/twoFactor.service.js';
import { issueTokenPair } from '../src/modules/auth/auth.service.js';
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
