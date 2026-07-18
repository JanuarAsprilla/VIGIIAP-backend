import { describe, it, expect, vi, beforeEach } from 'vitest';
import jwt from 'jsonwebtoken';

vi.mock('../src/config/database.js', () => ({
  query: vi.fn().mockResolvedValue({ rows: [] }),
  getClient: vi.fn(),
}));

vi.mock('../src/modules/auth/auth.service.js', () => ({
  issueTokenPair: vi.fn(),
  revokeAllRefreshTokens: vi.fn(),
}));

vi.mock('../src/modules/auth/twoFactor.service.js', () => ({
  verifyTotpOrBackup: vi.fn(),
}));

vi.mock('../src/utils/logger.js', () => ({
  default: { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() },
}));

import { query } from '../src/config/database.js';
import { issueTokenPair, revokeAllRefreshTokens } from '../src/modules/auth/auth.service.js';
import { verifyTotpOrBackup } from '../src/modules/auth/twoFactor.service.js';
import { changeExpiredPassword } from '../src/modules/auth/expiredPassword.controller.js';

process.env.JWT_SECRET = 'test-secret-for-expired-password';

function mockRes() {
  return {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
    cookie: vi.fn().mockReturnThis(),
    clearCookie: vi.fn().mockReturnThis(),
  };
}
const mockNext = vi.fn();

function makeToken(payload) {
  return jwt.sign(payload, process.env.JWT_SECRET, { algorithm: 'HS256', expiresIn: '15m' });
}

const USER_ROW = { id: 'user-uuid', nombre: 'Test User', email: 'user@iiap.org.co', rol: 'investigador' };

// ── changeExpiredPassword() ───────────────────────────────────────────────────

describe('changeExpiredPassword()', () => {
  beforeEach(() => vi.clearAllMocks());

  it('retorna 401 si no hay cookie vigiiap_expired_temp', async () => {
    const req = { cookies: {}, body: {}, ip: '127.0.0.1', headers: {} };
    const res = mockRes();
    await changeExpiredPassword(req, res, mockNext);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ error: expect.stringContaining('Token') })
    );
  });

  it('retorna 401 si el token JWT es inválido', async () => {
    const req = {
      cookies: { vigiiap_expired_temp: 'not-a-valid-jwt' },
      body: {},
      ip: '127.0.0.1',
      headers: {},
    };
    const res = mockRes();
    await changeExpiredPassword(req, res, mockNext);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ error: expect.stringContaining('inválido') })
    );
  });

  it('retorna 401 si el token tiene scope incorrecto', async () => {
    const token = makeToken({ id: 'user-uuid', scope: 'other-scope' });
    const req = {
      cookies: { vigiiap_expired_temp: token },
      body: {},
      ip: '127.0.0.1',
      headers: {},
    };
    const res = mockRes();
    await changeExpiredPassword(req, res, mockNext);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ error: expect.stringContaining('Token') })
    );
  });

  it('retorna 401 si 2FA activo y no se envía código TOTP', async () => {
    const token = makeToken({ id: 'user-uuid', scope: 'password-change' });
    query.mockResolvedValueOnce({ rows: [{ totp_enabled: true }] }); // SELECT totp_enabled

    const req = {
      cookies: { vigiiap_expired_temp: token },
      body: { password: 'NuevaPassword123!' },
      ip: '127.0.0.1',
      headers: {},
    };
    const res = mockRes();
    await changeExpiredPassword(req, res, mockNext);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ error: expect.stringContaining('TOTP') })
    );
  });

  it('verifica TOTP si 2FA está activo y se envía código', async () => {
    const token = makeToken({ id: 'user-uuid', scope: 'password-change' });
    query
      .mockResolvedValueOnce({ rows: [{ totp_enabled: true }] })              // SELECT totp_enabled
      .mockResolvedValueOnce({ rows: [{ password_hash: '$2b$12$dummy', expired_token_jti: 'test-jti' }] }) // SELECT for jti check
      .mockResolvedValueOnce({ rows: [] })                                    // UPDATE password
      .mockResolvedValueOnce({ rows: [USER_ROW] });                           // SELECT user

    verifyTotpOrBackup.mockResolvedValueOnce(true);
    issueTokenPair.mockResolvedValueOnce({
      accessToken: 'acc-tok',
      refreshToken: 'ref-tok',
    });
    revokeAllRefreshTokens.mockResolvedValueOnce(undefined);

    const req = {
      cookies: { vigiiap_expired_temp: token },
      body: { password: 'NuevaPassword123!', totpCode: '123456' },
      ip: '127.0.0.1',
      headers: { 'user-agent': 'Test/1.0' },
    };
    const res = mockRes();
    await changeExpiredPassword(req, res, mockNext);
    expect(verifyTotpOrBackup).toHaveBeenCalledWith('user-uuid', '123456');
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ message: expect.stringContaining('Contraseña actualizada') })
    );
  });

  it('actualiza contraseña y emite nuevas cookies cuando no hay 2FA', async () => {
    const token = makeToken({ id: 'user-uuid', scope: 'password-change' });
    query
      .mockResolvedValueOnce({ rows: [{ totp_enabled: false }] })             // SELECT totp_enabled
      .mockResolvedValueOnce({ rows: [{ password_hash: '$2b$12$dummy', expired_token_jti: 'test-jti' }] }) // SELECT for jti check
      .mockResolvedValueOnce({ rows: [] })                                    // UPDATE password
      .mockResolvedValueOnce({ rows: [USER_ROW] });                           // SELECT user

    revokeAllRefreshTokens.mockResolvedValueOnce(undefined);
    issueTokenPair.mockResolvedValueOnce({
      accessToken: 'acc-tok',
      refreshToken: 'ref-tok',
    });

    const req = {
      cookies: { vigiiap_expired_temp: token },
      body: { password: 'NuevaPassword123!' },
      ip: '127.0.0.1',
      headers: { 'user-agent': 'Test/1.0' },
    };
    const res = mockRes();
    await changeExpiredPassword(req, res, mockNext);

    expect(res.clearCookie).toHaveBeenCalledWith('vigiiap_expired_temp', expect.any(Object));
    expect(res.cookie).toHaveBeenCalledTimes(2); // access + refresh
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ message: expect.stringContaining('Contraseña actualizada') })
    );
  });

  it('llama next(err) ante error inesperado', async () => {
    const token = makeToken({ id: 'user-uuid', scope: 'password-change' });
    query.mockRejectedValueOnce(new Error('DB failure'));

    const req = {
      cookies: { vigiiap_expired_temp: token },
      body: { password: 'NuevaPassword123!' },
      ip: '127.0.0.1',
      headers: {},
    };
    const res = mockRes();
    await changeExpiredPassword(req, res, mockNext);
    expect(mockNext).toHaveBeenCalledWith(expect.any(Error));
  });
});
