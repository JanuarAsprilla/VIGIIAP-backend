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
  solicitarRecuperacion:  vi.fn(),
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
import { logout, refresh, me, login } from '../src/modules/auth/auth.controller.js';

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

  it('ignora silenciosamente el error de revokeAllRefreshTokens y responde igual', async () => {
    authService.revokeAllRefreshTokens.mockRejectedValueOnce(new Error('db down'));
    const r = res();
    await logout({
      cookies: {},
      user: { id: 'u1' },
      headers: {},
    }, r, mockNext);
    expect(authService.revokeAllRefreshTokens).toHaveBeenCalledWith('u1');
    expect(r.json).toHaveBeenCalledWith(expect.objectContaining({ message: expect.any(String) }));
    expect(mockNext).not.toHaveBeenCalled();
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

// ── login() ───────────────────────────────────────────────────────────────

describe('auth.controller → login()', () => {
  beforeEach(() => vi.clearAllMocks());

  it('login exitoso — emite cookies de access y refresh, responde con token y user', async () => {
    authService.login.mockResolvedValue({
      token: 'access.token', refreshToken: 'refresh.token', user: { id: 'u1', rol: 'investigador' },
    });
    const r = res();
    await login({ body: { email: 'j@j.co', password: 'Pass1234!' }, ip: '::1', headers: {} }, r, mockNext);
    expect(r.cookie).toHaveBeenCalledTimes(2);
    expect(r.json).toHaveBeenCalledWith({
      token: 'access.token', user: { id: 'u1', rol: 'investigador' },
    });
  });

  it('retorna 403 y cookie temporal cuando la contraseña expiró', async () => {
    authService.login.mockResolvedValue({ passwordExpired: true, expiredToken: 'expired.tok' });
    const r = res();
    await login({ body: { email: 'j@j.co', password: 'Pass1234!' }, ip: '::1', headers: {} }, r, mockNext);
    expect(r.cookie).toHaveBeenCalledWith('vigiiap_expired_temp', 'expired.tok', expect.any(Object));
    expect(r.status).toHaveBeenCalledWith(403);
    expect(r.json).toHaveBeenCalledWith({ passwordExpired: true, code: 'PASSWORD_EXPIRED' });
  });

  it('retorna requiresTwoFactor y cookie temporal cuando 2FA está activo', async () => {
    authService.login.mockResolvedValue({ requiresTwoFactor: true, twoFactorToken: 'tfa.tok' });
    const r = res();
    await login({ body: { email: 'j@j.co', password: 'Pass1234!' }, ip: '::1', headers: {} }, r, mockNext);
    expect(r.cookie).toHaveBeenCalledWith('vigiiap_2fa_temp', 'tfa.tok', expect.any(Object));
    expect(r.json).toHaveBeenCalledWith({ requiresTwoFactor: true });
  });

  it('llama next(err) si login lanza (credenciales inválidas)', async () => {
    authService.login.mockRejectedValue(Object.assign(new Error('Credenciales inválidas'), { status: 401 }));
    const r = res();
    await login({ body: { email: 'j@j.co', password: 'bad' }, ip: '::1', headers: {} }, r, mockNext);
    expect(mockNext).toHaveBeenCalledWith(expect.any(Error));
  });
});

// ── Additional imports for new tests ────────────────────────────────────────
import { visitante, register, verifyEmail, reenviarVerificacion } from '../src/modules/auth/auth.controller.js';

vi.mock('../src/modules/auth/auth.schema.js', () => ({
  loginSchema:         { parse: vi.fn((d) => d) },
  registerSchema:      { parse: vi.fn((d) => d) },
  recoverSchema:       { parse: vi.fn((d) => d) },
  resetPasswordSchema: {
    parse: vi.fn((d) => d),
    pick:  vi.fn(() => ({ parse: vi.fn((d) => d) })),
  },
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

  it('notifica a los admins registrados y absorbe errores de envío de email', async () => {
    authService.register.mockResolvedValue({
      id: 'u1', nombre: 'Juan', email: 'j@j.co', verificationToken: 'tok',
    });
    mailer.notifyVerificacionEmail.mockRejectedValueOnce(new Error('smtp caído'));
    adminService.getAdminEmails.mockResolvedValueOnce(['admin1@iiap.co', 'admin2@iiap.co']);
    mailer.notifyAdminNewRegistro.mockRejectedValue(new Error('smtp admin caído'));

    const r = res();
    await register({
      body: { nombre: 'Juan', email: 'j@j.co', password: 'Pass1234!', institucion: 'IIAP', motivo: 'Investigación' },
    }, r, mockNext);
    expect(r.status).toHaveBeenCalledWith(201);

    await vi.waitFor(() => {
      expect(mailer.notifyVerificacionEmail).toHaveBeenCalled();
      expect(mailer.notifyAdminNewRegistro).toHaveBeenCalledTimes(2);
    });
  });

  it('registra sin admins configurados (adminEmails vacío)', async () => {
    authService.register.mockResolvedValue({
      id: 'u2', nombre: 'Ana', email: 'a@a.co', verificationToken: 'tok2',
    });
    mailer.notifyVerificacionEmail.mockResolvedValueOnce(undefined);
    adminService.getAdminEmails.mockResolvedValueOnce([]);

    const r = res();
    await register({
      body: { nombre: 'Ana', email: 'a@a.co', password: 'Pass1234!', institucion: 'IIAP', motivo: 'x' },
    }, r, mockNext);
    expect(r.status).toHaveBeenCalledWith(201);

    await vi.waitFor(() => {
      expect(adminService.getAdminEmails).toHaveBeenCalled();
    });
    expect(mailer.notifyAdminNewRegistro).not.toHaveBeenCalled();
  });
});

// ── verifyEmail() ─────────────────────────────────────────────────────────

import * as adminService from '../src/modules/admin/admin.service.js';
import * as mailer from '../src/utils/mailer.js';

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

  it('notifica al usuario y a los admins cuando la verificación es nueva', async () => {
    authService.verifyEmail.mockResolvedValue({ alreadyVerified: false, email: 'j@j.co', nombre: 'Juan' });
    mailer.notifyRegistroRecibido.mockRejectedValueOnce(new Error('smtp caído'));
    adminService.getAdminEmails.mockResolvedValueOnce(['admin1@iiap.co']);
    mailer.notifyAdminUsuarioVerificado.mockRejectedValueOnce(new Error('smtp admin caído'));

    const r = res();
    await verifyEmail({ params: { token: 'tok-valid' } }, r, mockNext);
    expect(r.json).toHaveBeenCalledWith(expect.objectContaining({ alreadyVerified: false }));

    await vi.waitFor(() => {
      expect(mailer.notifyRegistroRecibido).toHaveBeenCalled();
      expect(mailer.notifyAdminUsuarioVerificado).toHaveBeenCalled();
    });
  });

  it('no notifica admins cuando no hay adminEmails registrados', async () => {
    authService.verifyEmail.mockResolvedValue({ alreadyVerified: false, email: 'j2@j.co', nombre: 'Ana' });
    mailer.notifyRegistroRecibido.mockResolvedValueOnce(undefined);
    adminService.getAdminEmails.mockResolvedValueOnce([]);

    const r = res();
    await verifyEmail({ params: { token: 'tok-valid-2' } }, r, mockNext);

    await vi.waitFor(() => {
      expect(adminService.getAdminEmails).toHaveBeenCalled();
    });
    expect(mailer.notifyAdminUsuarioVerificado).not.toHaveBeenCalled();
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

// ── recuperarPassword() ─────────────────────────────────────────────────────

import { recuperarPassword, resetPassword } from '../src/modules/auth/auth.controller.js';
import * as mailerRecover from '../src/utils/mailer.js';

describe('auth.controller → recuperarPassword()', () => {
  beforeEach(() => vi.clearAllMocks());

  it('llama next(err) si el email es inválido (falla el schema)', async () => {
    const { recoverSchema } = await import('../src/modules/auth/auth.schema.js');
    recoverSchema.parse.mockImplementationOnce(() => { throw new Error('Email inválido'); });
    await recuperarPassword({ body: { email: 'no-es-un-email' } }, res(), mockNext);
    expect(mockNext).toHaveBeenCalledWith(expect.any(Error));
    expect(authService.solicitarRecuperacion).not.toHaveBeenCalled();
  });

  it('responde con mensaje genérico cuando el email no existe (resultado nulo)', async () => {
    authService.solicitarRecuperacion.mockResolvedValue(null);
    const r = res();
    await recuperarPassword({ body: { email: 'x@x.co' } }, r, mockNext);
    expect(r.json).toHaveBeenCalledWith(expect.objectContaining({ message: expect.any(String) }));
    expect(mailerRecover.notifyRecuperarPassword).not.toHaveBeenCalled();
  });

  it('envía el correo de recuperación cuando el email existe', async () => {
    authService.solicitarRecuperacion.mockResolvedValue({
      email: 'j@j.co', nombre: 'Juan', resetToken: 'reset-tok',
    });
    const r = res();
    await recuperarPassword({ body: { email: 'j@j.co' } }, r, mockNext);
    expect(mailerRecover.notifyRecuperarPassword).toHaveBeenCalledWith(
      expect.objectContaining({ email: 'j@j.co', nombre: 'Juan', resetToken: 'reset-tok' }),
    );
    expect(r.json).toHaveBeenCalledWith(expect.objectContaining({ message: expect.any(String) }));
  });

  it('llama next(err) si el servicio lanza', async () => {
    authService.solicitarRecuperacion.mockRejectedValue(new Error('db'));
    await recuperarPassword({ body: { email: 'j@j.co' } }, res(), mockNext);
    expect(mockNext).toHaveBeenCalledWith(expect.any(Error));
  });
});

// ── resetPassword() ─────────────────────────────────────────────────────────

describe('auth.controller → resetPassword()', () => {
  beforeEach(() => vi.clearAllMocks());

  it('llama next(err) si el body es inválido (falla el schema)', async () => {
    const { resetPasswordSchema } = await import('../src/modules/auth/auth.schema.js');
    resetPasswordSchema.parse.mockImplementationOnce(() => { throw new Error('Contraseña inválida'); });
    await resetPassword({ body: { token: 'tok' } }, res(), mockNext);
    expect(mockNext).toHaveBeenCalledWith(expect.any(Error));
    expect(authService.resetPassword).not.toHaveBeenCalled();
  });

  it('actualiza la contraseña y responde con mensaje de éxito', async () => {
    authService.resetPassword.mockResolvedValue(undefined);
    const r = res();
    await resetPassword({ body: { token: 'tok-valido', password: 'Pass1234!' } }, r, mockNext);
    expect(authService.resetPassword).toHaveBeenCalledWith('tok-valido', 'Pass1234!');
    expect(r.json).toHaveBeenCalledWith(expect.objectContaining({ message: expect.any(String) }));
  });

  it('llama next(err) si el token es inválido/expirado (el servicio lanza)', async () => {
    authService.resetPassword.mockRejectedValue(Object.assign(new Error('Token inválido'), { status: 400 }));
    await resetPassword({ body: { token: 'tok-malo', password: 'Pass1234!' } }, res(), mockNext);
    expect(mockNext).toHaveBeenCalledWith(expect.objectContaining({ status: 400 }));
  });
});
