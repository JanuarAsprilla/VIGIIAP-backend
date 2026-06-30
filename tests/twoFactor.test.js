import { describe, it, expect, vi, beforeEach } from 'vitest';
import jwt from 'jsonwebtoken';

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
vi.mock('../src/config/database.js', () => ({
  query: vi.fn().mockResolvedValue({ rows: [] }),
  getClient: vi.fn(),
}));
vi.mock('qrcode', () => ({
  default: { toDataURL: vi.fn().mockResolvedValue('data:image/png;base64,fake') },
}));

import * as tfService from '../src/modules/auth/twoFactor.service.js';
import * as authService from '../src/modules/auth/auth.service.js';
import { query } from '../src/config/database.js';
import { setup, verify, disable, confirm } from '../src/modules/auth/twoFactor.controller.js';

const mockNext = vi.fn();
const USER = { id: 'uuid-u1', email: 'user@iiap.org.co' };

function res() {
  return { status: vi.fn().mockReturnThis(), json: vi.fn(), cookie: vi.fn(), clearCookie: vi.fn() };
}

describe('twoFactor.controller → setup()', () => {
  beforeEach(() => vi.clearAllMocks());

  it('retorna secret y qrDataUrl', async () => {
    tfService.setupTotp.mockResolvedValue({ secret: 'ABCD', otpauthUrl: 'otpauth://totp/test' });
    const r = res();
    await setup({ user: USER }, r, mockNext);
    expect(r.json).toHaveBeenCalledWith(expect.objectContaining({ secret: 'ABCD', qrDataUrl: expect.any(String) }));
  });

  it('llama next(err) si setupTotp lanza', async () => {
    tfService.setupTotp.mockRejectedValue(new Error('fail'));
    await setup({ user: USER }, res(), mockNext);
    expect(mockNext).toHaveBeenCalledWith(expect.any(Error));
  });
});

describe('twoFactor.controller → verify()', () => {
  beforeEach(() => vi.clearAllMocks());

  it('retorna 400 sin código', async () => {
    const r = res();
    await verify({ user: USER, body: {} }, r, mockNext);
    expect(r.status).toHaveBeenCalledWith(400);
  });

  it('activa 2FA y retorna backupCodes', async () => {
    tfService.enableTotp.mockResolvedValue({ backupCodes: ['A', 'B'] });
    const r = res();
    await verify({ user: USER, body: { code: '123456' } }, r, mockNext);
    expect(r.json).toHaveBeenCalledWith(expect.objectContaining({ backupCodes: ['A', 'B'] }));
  });

  it('llama next(err) si enableTotp lanza', async () => {
    tfService.enableTotp.mockRejectedValue(new Error('fail'));
    await verify({ user: USER, body: { code: '000000' } }, res(), mockNext);
    expect(mockNext).toHaveBeenCalledWith(expect.any(Error));
  });
});

describe('twoFactor.controller → disable()', () => {
  beforeEach(() => vi.clearAllMocks());

  it('retorna 400 sin código', async () => {
    const r = res();
    await disable({ user: USER, body: {} }, r, mockNext);
    expect(r.status).toHaveBeenCalledWith(400);
  });

  it('desactiva 2FA', async () => {
    tfService.disableTotp.mockResolvedValue(undefined);
    const r = res();
    await disable({ user: USER, body: { code: '123456' } }, r, mockNext);
    expect(r.json).toHaveBeenCalledWith(expect.objectContaining({ message: expect.any(String) }));
  });

  it('llama next(err) si disableTotp lanza', async () => {
    tfService.disableTotp.mockRejectedValue(new Error('fail'));
    await disable({ user: USER, body: { code: '000' } }, res(), mockNext);
    expect(mockNext).toHaveBeenCalledWith(expect.any(Error));
  });
});

describe('twoFactor.controller → confirm()', () => {
  beforeEach(() => vi.clearAllMocks());

  const tok2fa = jwt.sign({ id: 'uuid-u1', scope: '2fa' }, process.env.JWT_SECRET, { expiresIn: '1h' });

  it('retorna 401 sin cookie vigiiap_2fa_temp', async () => {
    const r = res();
    await confirm({ cookies: {}, body: {} }, r, mockNext);
    expect(r.status).toHaveBeenCalledWith(401);
  });

  it('retorna 401 con token inválido', async () => {
    const r = res();
    await confirm({ cookies: { vigiiap_2fa_temp: 'bad.token' }, body: {} }, r, mockNext);
    expect(r.status).toHaveBeenCalledWith(401);
  });

  it('retorna 401 si scope no es "2fa"', async () => {
    const bad = jwt.sign({ id: 'x', scope: 'other' }, process.env.JWT_SECRET);
    const r = res();
    await confirm({ cookies: { vigiiap_2fa_temp: bad }, body: {} }, r, mockNext);
    expect(r.status).toHaveBeenCalledWith(401);
  });

  it('retorna 400 sin código TOTP', async () => {
    const r = res();
    await confirm({ cookies: { vigiiap_2fa_temp: tok2fa }, body: {} }, r, mockNext);
    expect(r.status).toHaveBeenCalledWith(400);
  });

  it('emite tokens con código válido', async () => {
    tfService.verifyTotpOrBackup.mockResolvedValue(undefined);
    query.mockResolvedValueOnce({ rows: [{ id: 'uuid-u1', nombre: 'Juan', email: 'j@j.co', rol: 'investigador' }] });
    authService.issueTokenPair.mockResolvedValue({ accessToken: 'at', refreshToken: 'rt' });
    const r = res();
    await confirm({
      cookies: { vigiiap_2fa_temp: tok2fa },
      body: { code: '123456' }, ip: '::1',
      headers: { 'user-agent': 'test' },
    }, r, mockNext);
    expect(r.json).toHaveBeenCalledWith(expect.objectContaining({ token: 'at' }));
  });

  it('llama next(err) si verifyTotpOrBackup lanza', async () => {
    tfService.verifyTotpOrBackup.mockRejectedValue(new Error('bad code'));
    await confirm({
      cookies: { vigiiap_2fa_temp: tok2fa },
      body: { code: '000000' }, ip: '::1',
      headers: { 'user-agent': 'test' },
    }, res(), mockNext);
    expect(mockNext).toHaveBeenCalledWith(expect.any(Error));
  });
});
