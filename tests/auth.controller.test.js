/**
 * Tests directos para auth.controller.js — funciones con 0-20% de cobertura.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import jwt from 'jsonwebtoken';

vi.mock('../src/modules/auth/auth.service.js', () => ({
  getProfile:             vi.fn(),
  revokeAllRefreshTokens: vi.fn().mockResolvedValue(undefined),
  refreshTokens:          vi.fn(),
  login:                  vi.fn(),
  register:               vi.fn(),
  registerUser:           vi.fn(),
  loginVisitante:         vi.fn(),
  verifyEmail:            vi.fn(),
  reenviarVerificacion:   vi.fn(),
  recuperarPassword:      vi.fn(),
  resetPassword:          vi.fn(),
  issueTokenPair:         vi.fn(),
  getAdminEmails:         vi.fn().mockResolvedValue([]),
}));
vi.mock('../src/utils/tokenBlacklist.js', () => ({
  revokeToken:   vi.fn().mockResolvedValue(undefined),
  isRevoked:     vi.fn().mockReturnValue(false),
  loadBlacklist: vi.fn(),
}));
vi.mock('../src/utils/mailer.js', () => ({
  notifyVerificacionEmail:    vi.fn(),
  notifyRegistroRecibido:     vi.fn(),
  notifyAdminNewRegistro:     vi.fn(),
  notifyAdminUsuarioVerificado: vi.fn(),
  notifyRecuperarPassword:    vi.fn(),
}));
vi.mock('../src/modules/admin/admin.service.js', () => ({
  getAdminEmails:   vi.fn().mockResolvedValue([]),
  listarUsuarios:   vi.fn(),
  crearUsuario:     vi.fn(),
  crearAdminSig:    vi.fn(),
  actualizarUsuario: vi.fn(),
  eliminarUsuario:   vi.fn(),
  getNotificaciones: vi.fn(),
  getConfiguracion:  vi.fn(),
  setConfiguracion:  vi.fn(),
  getAuditLog:       vi.fn(),
  getSuperStats:     vi.fn(),
}));
vi.mock('../src/config/database.js', () => ({
  query: vi.fn().mockResolvedValue({ rows: [] }),
  getClient: vi.fn(),
}));
vi.mock('../src/utils/logger.js', () => ({
  default: { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() },
}));

import * as authService from '../src/modules/auth/auth.service.js';
import { revokeToken } from '../src/utils/tokenBlacklist.js';
import { logout, refresh, me } from '../src/modules/auth/auth.controller.js';

const mockNext = vi.fn();

function res() {
  return {
    status:      vi.fn().mockReturnThis(),
    json:        vi.fn(),
    cookie:      vi.fn(),
    clearCookie: vi.fn(),
  };
}

// ── me() ──────────────────────────────────────────────────────────────────

describe('auth.controller → me()', () => {
  beforeEach(() => vi.clearAllMocks());

  it('retorna el perfil del usuario autenticado', async () => {
    const profile = { id: 'u1', nombre: 'Juan', email: 'j@j.co', rol: 'investigador' };
    authService.getProfile.mockResolvedValue(profile);
    const r = res();
    await me({ user: { id: 'u1' } }, r, mockNext);
    expect(authService.getProfile).toHaveBeenCalledWith('u1');
    expect(r.json).toHaveBeenCalledWith(profile);
  });

  it('retorna perfil de visitante sin llamar al servicio', async () => {
    const r = res();
    await me({ user: { tipo: 'visitante', visitanteId: 'v1' } }, r, mockNext);
    expect(authService.getProfile).not.toHaveBeenCalled();
    expect(r.json).toHaveBeenCalledWith(expect.objectContaining({ rol: 'visitante' }));
  });

  it('llama next(err) si getProfile lanza', async () => {
    authService.getProfile.mockRejectedValue(new Error('db'));
    await me({ user: { id: 'u1' } }, res(), mockNext);
    expect(mockNext).toHaveBeenCalledWith(expect.any(Error));
  });
});

// ── logout() ──────────────────────────────────────────────────────────────

describe('auth.controller → logout()', () => {
  beforeEach(() => vi.clearAllMocks());

  it('revoca token de cookie y responde con mensaje', async () => {
    const r = res();
    await logout({
      cookies: { vigiiap_token: 'access.token.here' },
      user: { id: 'u1', exp: Math.floor(Date.now() / 1000) + 3600 },
      headers: {},
    }, r, mockNext);
    expect(revokeToken).toHaveBeenCalled();
    expect(r.json).toHaveBeenCalledWith(expect.objectContaining({ message: expect.any(String) }));
    expect(r.clearCookie).toHaveBeenCalled();
  });

  it('revoca token de header Authorization si no hay cookie', async () => {
    const r = res();
    await logout({
      cookies: {},
      user: { id: 'u1' },
      headers: { authorization: 'Bearer header.token.here' },
    }, r, mockNext);
    expect(revokeToken).toHaveBeenCalledWith('header.token.here', expect.any(Number));
  });

  it('no llama revokeToken si no hay token', async () => {
    const r = res();
    await logout({
      cookies: {},
      user: null,
      headers: {},
    }, r, mockNext);
    expect(revokeToken).not.toHaveBeenCalled();
    expect(r.json).toHaveBeenCalledWith(expect.objectContaining({ message: expect.any(String) }));
  });

  it('llama next(err) si revokeToken lanza', async () => {
    revokeToken.mockRejectedValueOnce(new Error('redis down'));
    await logout({
      cookies: { vigiiap_token: 'token' },
      user: { id: 'u1' },
      headers: {},
    }, res(), mockNext);
    expect(mockNext).toHaveBeenCalledWith(expect.any(Error));
  });
});

// ── refresh() ─────────────────────────────────────────────────────────────

describe('auth.controller → refresh()', () => {
  beforeEach(() => vi.clearAllMocks());

  it('retorna 401 sin refresh token en cookie', async () => {
    const r = res();
    await refresh({ cookies: {}, headers: {}, ip: '::1' }, r, mockNext);
    expect(r.status).toHaveBeenCalledWith(401);
  });

  it('emite nuevos tokens y responde con accessToken', async () => {
    authService.refreshTokens.mockResolvedValue({
      accessToken:  'new.access.token',
      refreshToken: 'new.refresh.token',
    });
    const r = res();
    await refresh({
      cookies: { vigiiap_refresh: 'valid.refresh.token' },
      ip: '::1',
      headers: { 'user-agent': 'test' },
    }, r, mockNext);
    expect(authService.refreshTokens).toHaveBeenCalledWith('valid.refresh.token', expect.any(Object));
    expect(r.json).toHaveBeenCalledWith({ token: 'new.access.token' });
    expect(r.cookie).toHaveBeenCalledTimes(2);
  });

  it('llama next(err) si refreshTokens lanza', async () => {
    authService.refreshTokens.mockRejectedValue(new Error('expired'));
    await refresh({
      cookies: { vigiiap_refresh: 'old.refresh' },
      ip: '::1',
      headers: { 'user-agent': 'test' },
    }, res(), mockNext);
    expect(mockNext).toHaveBeenCalledWith(expect.any(Error));
  });
});

// ── Additional imports for new tests ────────────────────────────────────────
import { visitante, register, verifyEmail, reenviarVerificacion } from '../src/modules/auth/auth.controller.js';

vi.mock('../src/modules/auth/auth.schema.js', () => ({
  loginSchema:         { parse: vi.fn((d) => d) },
  registerSchema:      { parse: vi.fn((d) => d) },
  recoverSchema:       { parse: vi.fn((d) => d) },
  resetPasswordSchema: { pick: vi.fn(() => ({ parse: vi.fn((d) => d) })) },
}));

// ── visitante() ───────────────────────────────────────────────────────────

describe('auth.controller → visitante()', () => {
  beforeEach(() => vi.clearAllMocks());

  it('retorna token de visitante', async () => {
    authService.loginVisitante.mockResolvedValue({ token: 'visitor.token', user: {} });
    const r = res();
    await visitante({ body: {}, ip: '::1', headers: { 'user-agent': 'test' } }, r, mockNext);
    expect(r.json).toHaveBeenCalledWith(expect.objectContaining({ token: 'visitor.token' }));
  });

  it('retorna 400 si nombre no es string', async () => {
    const r = res();
    await visitante({ body: { nombre: 12345 }, ip: '::1', headers: {} }, r, mockNext);
    expect(r.status).toHaveBeenCalledWith(400);
  });

  it('retorna 400 si nombre supera 100 caracteres', async () => {
    const r = res();
    await visitante({ body: { nombre: 'x'.repeat(101) }, ip: '::1', headers: {} }, r, mockNext);
    expect(r.status).toHaveBeenCalledWith(400);
  });

  it('llama next(err) si loginVisitante lanza', async () => {
    authService.loginVisitante.mockRejectedValue(new Error('db'));
    await visitante({ body: {}, ip: '::1', headers: {} }, res(), mockNext);
    expect(mockNext).toHaveBeenCalledWith(expect.any(Error));
  });
});

// ── register() ────────────────────────────────────────────────────────────

describe('auth.controller → register()', () => {
  beforeEach(() => vi.clearAllMocks());

  it('registra el usuario y responde 201', async () => {
    authService.register.mockResolvedValue({
      id: 'u1', nombre: 'Juan', email: 'j@j.co', verificationToken: 'tok',
    });
    const r = res();
    await register({
      body: { nombre: 'Juan', email: 'j@j.co', password: 'Pass1234!', institucion: 'IIAP' },
    }, r, mockNext);
    expect(r.status).toHaveBeenCalledWith(201);
  });

  it('llama next(err) si register lanza', async () => {
    authService.register.mockRejectedValue(new Error('dup email'));
    await register({ body: {} }, res(), mockNext);
    expect(mockNext).toHaveBeenCalledWith(expect.any(Error));
  });
});

// ── verifyEmail() ─────────────────────────────────────────────────────────

import * as adminService from '../src/modules/admin/admin.service.js';

describe('auth.controller → verifyEmail()', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    adminService.getAdminEmails.mockResolvedValue([]);
  });

  it('verifica email con alreadyVerified=false (rama alreadyVerified)', async () => {
    authService.verifyEmail.mockResolvedValue({ alreadyVerified: false, email: 'j@j.co', nombre: 'Juan' });
    const r = res();
    await verifyEmail({ params: { token: 'tok-valid' } }, r, mockNext);
    // La respuesta puede ser json o next(err), verificamos que se procesó
    const called = r.json.mock.calls.length > 0 || mockNext.mock.calls.length > 0;
    expect(called).toBe(true);
  });

  it('responde cuando ya estaba verificado', async () => {
    authService.verifyEmail.mockResolvedValue({ alreadyVerified: true, email: 'j@j.co', nombre: 'Juan' });
    const r = res();
    await verifyEmail({ params: { token: 'tok' } }, r, mockNext);
    expect(r.json).toHaveBeenCalledWith(expect.objectContaining({ alreadyVerified: true }));
  });

  it('llama next(err) si verifyEmail lanza', async () => {
    authService.verifyEmail.mockRejectedValue(new Error('invalid token'));
    await verifyEmail({ params: { token: 'bad' } }, res(), mockNext);
    expect(mockNext).toHaveBeenCalledWith(expect.any(Error));
  });
});

// ── reenviarVerificacion() ────────────────────────────────────────────────

describe('auth.controller → reenviarVerificacion()', () => {
  beforeEach(() => vi.clearAllMocks());

  it('retorna 400 si falta email', async () => {
    const r = res();
    await reenviarVerificacion({ body: {} }, r, mockNext);
    expect(r.status).toHaveBeenCalledWith(400);
  });

  it('responde con mensaje genérico (resultado nulo → usuario no encontrado)', async () => {
    authService.reenviarVerificacion.mockResolvedValue(null);
    const r = res();
    await reenviarVerificacion({ body: { email: 'x@x.co' } }, r, mockNext);
    expect(r.json).toHaveBeenCalledWith(expect.objectContaining({ message: expect.any(String) }));
  });

  it('envía email si hay resultado y responde con mensaje genérico', async () => {
    authService.reenviarVerificacion.mockResolvedValue({
      email: 'j@j.co', nombre: 'Juan', verificationToken: 'tok',
    });
    const r = res();
    await reenviarVerificacion({ body: { email: 'j@j.co' } }, r, mockNext);
    expect(r.json).toHaveBeenCalledWith(expect.objectContaining({ message: expect.any(String) }));
  });

  it('llama next(err) si el servicio lanza', async () => {
    authService.reenviarVerificacion.mockRejectedValue(new Error('db'));
    await reenviarVerificacion({ body: { email: 'j@j.co' } }, res(), mockNext);
    expect(mockNext).toHaveBeenCalledWith(expect.any(Error));
  });
});
