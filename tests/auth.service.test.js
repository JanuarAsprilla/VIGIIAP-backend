import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Mocks (deben declararse ANTES de los imports del módulo bajo prueba) ──────
vi.mock('../src/config/database.js', () => ({
  query: vi.fn(),
  getClient: vi.fn(),
}));

vi.mock('../src/utils/auditLog.js', () => ({
  registrarAuditoria: vi.fn(),
}));

vi.mock('bcryptjs', () => ({
  default: {
    compare: vi.fn(),
    hash: vi.fn(),
  },
}));

vi.mock('jsonwebtoken', () => ({
  default: {
    sign: vi.fn().mockReturnValue('mocked-token'),
    verify: vi.fn(),
  },
}));

vi.mock('../src/utils/tokenBlacklist.js', () => ({
  isRevoked: vi.fn().mockReturnValue(false),
  revokeToken: vi.fn().mockResolvedValue(undefined),
  loadBlacklist: vi.fn().mockResolvedValue(undefined),
  revokeAllRefreshTokens: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../src/utils/mailer.js', () => ({
  notifyNuevoInicioSesion: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../src/utils/configFlags.js', () => ({
  notificacionHabilitada: vi.fn().mockResolvedValue(false),
}));
vi.mock('../src/utils/logger.js', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

// ─── Imports bajo prueba ───────────────────────────────────────────────────────
import { query } from '../src/config/database.js';
import { registrarAuditoria } from '../src/utils/auditLog.js';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import {
  login,
  register,
  getProfile,
  loginVisitante,
  resetPassword,
} from '../src/modules/auth/auth.service.js';
import { revokeAllRefreshTokens } from '../src/utils/tokenBlacklist.js';
import { notifyNuevoInicioSesion } from '../src/utils/mailer.js';
import { notificacionHabilitada } from '../src/utils/configFlags.js';

// ─── Fixtures ─────────────────────────────────────────────────────────────────
const mockUser = {
  id: 'uuid-001',
  nombre: 'Admin Test',
  email: 'admin@iiap.gob.pe',
  password_hash: '$2a$12$hashedpassword',
  rol: 'admin_sig',
  activo: true,
  email_verified: true,
  intentos_fallidos: 0,
  bloqueado_hasta: null,
};

// ─── login() ──────────────────────────────────────────────────────────────────
describe('login()', () => {
  beforeEach(() => vi.clearAllMocks());

  it('retorna token y datos de usuario con credenciales válidas', async () => {
    query
      .mockResolvedValueOnce({ rows: [mockUser] })                       // SELECT usuario
      .mockResolvedValueOnce({ rows: [] })                               // UPDATE last_login_at
      .mockResolvedValueOnce({ rows: [{ totp_enabled: false }] })       // SELECT totp_enabled
      .mockResolvedValueOnce({ rows: [{ id: 'rt-uuid-1' }] });          // INSERT refresh_tokens
    bcrypt.compare.mockResolvedValueOnce(true);

    const result = await login('admin@iiap.gob.pe', 'Segura123!', '127.0.0.1', 'jest');

    expect(result).toMatchObject({
      token: 'mocked-token',
      user: {
        id: mockUser.id,
        email: mockUser.email,
        rol: mockUser.rol,
      },
    });
    expect(registrarAuditoria).toHaveBeenCalledWith(
      expect.objectContaining({ accion: 'login', modulo: 'auth' })
    );
  });

  it('el user devuelto incluye avatar_url, institucion y twoFactorEnabled — mismo shape que /auth/me', async () => {
    const fullUser = {
      ...mockUser,
      institucion: 'IIAP', tipo_acceso: 'institucional',
      avatar_url: 'https://files.test.local/avatars/x.jpg', totp_enabled: false,
    };
    query
      .mockResolvedValueOnce({ rows: [fullUser] })                       // SELECT usuario
      .mockResolvedValueOnce({ rows: [] })                               // UPDATE last_login_at
      .mockResolvedValueOnce({ rows: [{ totp_enabled: false }] })       // SELECT totp_enabled
      .mockResolvedValueOnce({ rows: [{ id: 'rt-uuid-1' }] });          // INSERT refresh_tokens
    bcrypt.compare.mockResolvedValueOnce(true);

    const result = await login('admin@iiap.gob.pe', 'Segura123!', '127.0.0.1', 'jest');

    expect(result.user).toMatchObject({
      institucion: 'IIAP',
      tipo_acceso: 'institucional',
      avatar_url: 'https://files.test.local/avatars/x.jpg',
      twoFactorEnabled: false,
    });
  });

  it('lanza 401 cuando el usuario no existe', async () => {
    query.mockResolvedValueOnce({ rows: [] });

    await expect(login('noexiste@iiap.gob.pe', 'pass', '127.0.0.1', 'jest')).rejects.toMatchObject({
      status: 401,
    });
    // bcrypt.compare DEBE llamarse con el hash dummy para igualar el tiempo de respuesta
    // y evitar que un atacante distinga emails registrados de los que no existen (timing attack).
    expect(bcrypt.compare).toHaveBeenCalledOnce();
  });

  it('lanza 401 cuando la contraseña es incorrecta', async () => {
    query
      .mockResolvedValueOnce({ rows: [mockUser] })    // SELECT usuario
      .mockResolvedValueOnce({ rows: [] });            // UPDATE intentos_fallidos
    bcrypt.compare.mockResolvedValueOnce(false);

    await expect(login('admin@iiap.gob.pe', 'wrong', '127.0.0.1', 'jest')).rejects.toMatchObject({
      status: 401,
    });
    expect(registrarAuditoria).toHaveBeenCalledWith(
      expect.objectContaining({ accion: 'login_failed', modulo: 'auth' })
    );
  });

  it('lanza 403 con code EMAIL_NOT_VERIFIED si el email no está verificado', async () => {
    const unverified = { ...mockUser, email_verified: false, activo: true };
    query.mockResolvedValueOnce({ rows: [unverified] });
    bcrypt.compare.mockResolvedValueOnce(true);

    await expect(login('admin@iiap.gob.pe', 'Segura123!', '127.0.0.1', 'jest')).rejects.toMatchObject({
      status: 403,
      code: 'EMAIL_NOT_VERIFIED',
    });
  });

  it('lanza 403 con code ACCOUNT_INACTIVE si la cuenta no está activa', async () => {
    const inactive = { ...mockUser, email_verified: true, activo: false };
    query.mockResolvedValueOnce({ rows: [inactive] });
    bcrypt.compare.mockResolvedValueOnce(true);

    await expect(login('admin@iiap.gob.pe', 'Segura123!', '127.0.0.1', 'jest')).rejects.toMatchObject({
      status: 403,
      code: 'ACCOUNT_INACTIVE',
    });
  });

  it('normaliza el email a minúsculas al buscar en BD', async () => {
    query
      .mockResolvedValueOnce({ rows: [mockUser] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ totp_enabled: false }] })
      .mockResolvedValueOnce({ rows: [{ id: 'rt-uuid-1' }] });
    bcrypt.compare.mockResolvedValueOnce(true);

    await login('ADMIN@IIAP.GOB.PE', 'Segura123!', '127.0.0.1', 'jest');

    expect(query).toHaveBeenCalledWith(
      expect.stringContaining('WHERE email = $1'),
      ['admin@iiap.gob.pe']
    );
  });
});

describe('login() — notificación de nuevo inicio de sesión (loginNotifs)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('no envía el correo cuando loginNotifs está deshabilitado (default)', async () => {
    query
      .mockResolvedValueOnce({ rows: [mockUser] })              // SELECT usuario
      .mockResolvedValueOnce({ rows: [] })                      // UPDATE last_login_at
      .mockResolvedValueOnce({ rows: [{ valor: '90' }] })       // SELECT passwordExpiryDays (mockUser.rol = admin_sig)
      .mockResolvedValueOnce({ rows: [{ totp_enabled: false }] }) // SELECT totp_enabled
      .mockResolvedValueOnce({ rows: [] });                     // INSERT refresh_tokens
    bcrypt.compare.mockResolvedValueOnce(true);
    notificacionHabilitada.mockResolvedValueOnce(false);

    await login('admin@iiap.gob.pe', 'Segura123!', '127.0.0.1', 'jest');

    await vi.waitFor(() => expect(notificacionHabilitada).toHaveBeenCalledWith('loginNotifs'));
    expect(notifyNuevoInicioSesion).not.toHaveBeenCalled();
  });

  it('envía el correo con IP y user-agent cuando loginNotifs está habilitado', async () => {
    query
      .mockResolvedValueOnce({ rows: [mockUser] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ valor: '90' }] })
      .mockResolvedValueOnce({ rows: [{ totp_enabled: false }] })
      .mockResolvedValueOnce({ rows: [] });
    bcrypt.compare.mockResolvedValueOnce(true);
    notificacionHabilitada.mockResolvedValueOnce(true);

    await login('admin@iiap.gob.pe', 'Segura123!', '203.0.113.5', 'TestAgent/1.0');

    await vi.waitFor(() => {
      expect(notifyNuevoInicioSesion).toHaveBeenCalledWith(
        expect.objectContaining({ email: mockUser.email, ip: '203.0.113.5', userAgent: 'TestAgent/1.0' }),
      );
    });
  });

  it('no se envía en el camino de 2FA requerido — el login aún no está completo', async () => {
    query
      .mockResolvedValueOnce({ rows: [mockUser] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ valor: '90' }] })
      .mockResolvedValueOnce({ rows: [{ totp_enabled: true }] });
    bcrypt.compare.mockResolvedValueOnce(true);

    const result = await login('admin@iiap.gob.pe', 'Segura123!', '127.0.0.1', 'jest');

    expect(result.requiresTwoFactor).toBe(true);
    expect(notificacionHabilitada).not.toHaveBeenCalledWith('loginNotifs');
    expect(notifyNuevoInicioSesion).not.toHaveBeenCalled();
  });
});

// ─── register() ───────────────────────────────────────────────────────────────
describe('register()', () => {
  beforeEach(() => vi.clearAllMocks());

  const validData = {
    nombre: 'Nuevo Usuario',
    email: 'nuevo@iiap.gob.pe',
    password: 'Segura123!',
    institucion: 'IIAP',
    motivo: 'Investigación',
    tipoAcceso: 'externo',
    perfil: 'investigador',
  };

  it('crea el usuario y retorna sus datos cuando el email es nuevo', async () => {
    // 1ra query: check duplicado → vacío
    query.mockResolvedValueOnce({ rows: [] });
    // 2da query: lectura de configuracion.requireApproval → ausente (default seguro)
    query.mockResolvedValueOnce({ rows: [] });
    // 3ra query: INSERT → nuevo usuario
    query.mockResolvedValueOnce({
      rows: [{ id: 'uuid-002', nombre: 'Nuevo Usuario', email: 'nuevo@iiap.gob.pe', rol: 'investigador' }],
    });
    bcrypt.hash.mockResolvedValueOnce('$2a$12$hashed');

    const result = await register(validData);

    expect(result).toMatchObject({ id: 'uuid-002', email: 'nuevo@iiap.gob.pe' });
    expect(result).toHaveProperty('verificationToken');
    expect(bcrypt.hash).toHaveBeenCalledWith(validData.password, 12);
  });

  it('lanza 409 cuando el email ya está registrado', async () => {
    query.mockResolvedValueOnce({ rows: [{ id: 'uuid-000' }] });

    await expect(register(validData)).rejects.toMatchObject({ status: 409 });
    // No debe consultar configuracion ni llamar a INSERT
    expect(query).toHaveBeenCalledTimes(1);
  });

  it('asigna rol "publico" cuando el perfil no es reconocido', async () => {
    query.mockResolvedValueOnce({ rows: [] });
    query.mockResolvedValueOnce({ rows: [] }); // configuracion.requireApproval ausente
    query.mockResolvedValueOnce({
      rows: [{ id: 'uuid-003', nombre: 'Test', email: 'test@test.com', rol: 'publico' }],
    });
    bcrypt.hash.mockResolvedValueOnce('$2a$12$hashed');

    await register({ ...validData, perfil: 'desconocido' });

    // El tercer query (INSERT) debe haber sido llamado con rol 'publico'
    const insertParams = query.mock.calls[2][1];
    expect(insertParams[5]).toBe('publico'); // índice 5 = rol en el array de params
  });

  it('normaliza email a minúsculas antes de insertar', async () => {
    query.mockResolvedValueOnce({ rows: [] });
    query.mockResolvedValueOnce({ rows: [] }); // configuracion.requireApproval ausente
    query.mockResolvedValueOnce({
      rows: [{ id: 'uuid-004', nombre: 'Test', email: 'upper@test.com', rol: 'investigador' }],
    });
    bcrypt.hash.mockResolvedValueOnce('$2a$12$hashed');

    await register({ ...validData, email: 'UPPER@TEST.COM' });

    expect(query.mock.calls[0][1]).toEqual(['upper@test.com']);
  });

  it('registra auditoría con accion "registro" cuando el registro es exitoso', async () => {
    query.mockResolvedValueOnce({ rows: [] });
    query.mockResolvedValueOnce({ rows: [] }); // configuracion.requireApproval ausente
    query.mockResolvedValueOnce({
      rows: [{ id: 'uuid-005', nombre: 'Nuevo Usuario', email: 'nuevo@iiap.gob.pe', rol: 'investigador' }],
    });
    bcrypt.hash.mockResolvedValueOnce('$2a$12$hashed');

    await register(validData, { ip: '127.0.0.1', userAgent: 'jest' });

    expect(registrarAuditoria).toHaveBeenCalledWith(
      expect.objectContaining({
        accion: 'registro',
        modulo: 'auth',
        entidadId: 'uuid-005',
        usuarioId: 'uuid-005',
        usuarioEmail: 'nuevo@iiap.gob.pe',
        ip: '127.0.0.1',
        userAgent: 'jest',
      })
    );
  });

  // ─── requireApproval — activación automática vs. aprobación manual ──────────
  describe('register() → activo inicial (config requireApproval)', () => {
    it('activo=false (requiere aprobación) cuando requireApproval está ausente en configuracion (default seguro)', async () => {
      query.mockResolvedValueOnce({ rows: [] });          // duplicado → no existe
      query.mockResolvedValueOnce({ rows: [] });          // requireApproval ausente
      query.mockResolvedValueOnce({ rows: [{ id: 'uuid-010', nombre: 'T', email: 't@t.co', rol: 'investigador' }] });
      bcrypt.hash.mockResolvedValueOnce('$2a$12$hashed');

      await register(validData);

      const insertParams = query.mock.calls[2][1];
      expect(insertParams[7]).toBe(false); // índice 7 = activo
    });

    it('activo=false (requiere aprobación) cuando requireApproval="true"', async () => {
      query.mockResolvedValueOnce({ rows: [] });
      query.mockResolvedValueOnce({ rows: [{ valor: 'true' }] });
      query.mockResolvedValueOnce({ rows: [{ id: 'uuid-011', nombre: 'T', email: 't@t.co', rol: 'investigador' }] });
      bcrypt.hash.mockResolvedValueOnce('$2a$12$hashed');

      await register(validData);

      const insertParams = query.mock.calls[2][1];
      expect(insertParams[7]).toBe(false);
    });

    it('activo=true (sin aprobación) cuando requireApproval="false"', async () => {
      query.mockResolvedValueOnce({ rows: [] });
      query.mockResolvedValueOnce({ rows: [{ valor: 'false' }] });
      query.mockResolvedValueOnce({ rows: [{ id: 'uuid-012', nombre: 'T', email: 't@t.co', rol: 'investigador' }] });
      bcrypt.hash.mockResolvedValueOnce('$2a$12$hashed');

      await register(validData);

      const insertParams = query.mock.calls[2][1];
      expect(insertParams[7]).toBe(true);
    });
  });
});

// ─── getProfile() ─────────────────────────────────────────────────────────────
describe('getProfile()', () => {
  beforeEach(() => vi.clearAllMocks());

  it('retorna el perfil del usuario cuando el id existe', async () => {
    const profileRow = {
      id: 'uuid-001',
      nombre: 'Admin Test',
      email: 'admin@iiap.gob.pe',
      rol: 'admin_sig',
      tipo_acceso: 'institucional',
      institucion: 'IIAP',
      avatar_url: 'https://files.test.local/avatars/admin.jpg',
      twoFactorEnabled: true,
      creado_en: new Date().toISOString(),
    };
    query.mockResolvedValueOnce({ rows: [profileRow] });

    const result = await getProfile('uuid-001');

    expect(result).toMatchObject({
      id: 'uuid-001',
      email: 'admin@iiap.gob.pe',
      avatar_url: 'https://files.test.local/avatars/admin.jpg',
      twoFactorEnabled: true,
    });
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining('WHERE id = $1'),
      ['uuid-001']
    );
    // La consulta debe seleccionar avatar_url y alias totp_enabled → twoFactorEnabled
    // (antes de este fix, /auth/me nunca devolvía el estado real de 2FA al frontend)
    expect(query.mock.calls[0][0]).toMatch(/avatar_url/);
    expect(query.mock.calls[0][0]).toMatch(/totp_enabled AS "twoFactorEnabled"/);
  });

  it('lanza 404 cuando el id no existe', async () => {
    query.mockResolvedValueOnce({ rows: [] });

    await expect(getProfile('uuid-inexistente')).rejects.toMatchObject({ status: 404 });
  });
});

// ─── loginVisitante() ─────────────────────────────────────────────────────────
describe('loginVisitante()', () => {
  beforeEach(() => vi.clearAllMocks());

  it('crea registro de visitante con nombre cuando se provee', async () => {
    query.mockResolvedValueOnce({ rows: [{ id: 'vis-001' }] });

    const result = await loginVisitante({
      nombre: 'Juan Pérez',
      ip: '192.168.1.1',
      userAgent: 'Mozilla/5.0',
    });

    expect(result.token).toBe('mocked-token');
    expect(result.user).toMatchObject({
      id: 'vis-001',
      nombre: 'Juan Pérez',
      rol: 'visitante',
    });
    expect(registrarAuditoria).toHaveBeenCalledWith(
      expect.objectContaining({ accion: 'login_visitante' })
    );
  });

  it('usa "Visitante" como nombre cuando no se provee ninguno', async () => {
    query.mockResolvedValueOnce({ rows: [{ id: 'vis-002' }] });

    const result = await loginVisitante({ nombre: undefined, ip: null, userAgent: null });

    expect(result.user.nombre).toBe('Visitante');
  });

  it('inserta null en BD cuando el nombre es undefined', async () => {
    query.mockResolvedValueOnce({ rows: [{ id: 'vis-003' }] });

    await loginVisitante({ nombre: undefined, ip: '10.0.0.1', userAgent: 'curl' });

    const insertParams = query.mock.calls[0][1];
    expect(insertParams[0]).toBeNull(); // nombre → null
  });

  it('firma el token con rol "visitante" y expiración de 8h', async () => {
    query.mockResolvedValueOnce({ rows: [{ id: 'vis-004' }] });

    await loginVisitante({ nombre: 'Anon', ip: null, userAgent: null });

    expect(jwt.sign).toHaveBeenCalledWith(
      expect.objectContaining({ rol: 'visitante', tipo: 'visitante' }),
      process.env.JWT_SECRET,
      { expiresIn: '8h' }
    );
  });
});

// ─── last_login_at ─────────────────────────────────────────────────────────────
describe('login() — last_login_at', () => {
  beforeEach(() => vi.clearAllMocks());

  it('actualiza last_login_at en cada login exitoso', async () => {
    const mockUser = {
      id: 'uuid-001', nombre: 'Admin', email: 'admin@iiap.gob.pe',
      password_hash: '$2a$12$hash', rol: 'admin_sig',
      activo: true, email_verified: true,
      intentos_fallidos: 0, bloqueado_hasta: null,
    };
    query
      .mockResolvedValueOnce({ rows: [mockUser] })
      .mockResolvedValueOnce({ rows: [] })                               // UPDATE last_login_at
      .mockResolvedValueOnce({ rows: [{ totp_enabled: false }] })       // SELECT totp_enabled
      .mockResolvedValueOnce({ rows: [] });                              // INSERT refresh_tokens
    bcrypt.compare.mockResolvedValueOnce(true);

    await login('admin@iiap.gob.pe', 'Segura123!', '127.0.0.1', 'jest');

    const updateCall = query.mock.calls.find(([sql]) => sql.includes('last_login_at'));
    expect(updateCall).toBeDefined();
  });
});

// ─── resetPassword() ───────────────────────────────────────────────────────────
describe('resetPassword()', () => {
  beforeEach(() => vi.clearAllMocks());

  it('revoca todas las sesiones tras resetear contraseña exitosamente', async () => {
    const mockUser = {
      id: 'uuid-001',
      email: 'admin@iiap.gob.pe',
      password_reset_expires: new Date(Date.now() + 60_000).toISOString(),
    };
    query
      .mockResolvedValueOnce({ rows: [mockUser] })
      .mockResolvedValueOnce({ rows: [] });
    bcrypt.hash.mockResolvedValueOnce('$2a$12$newhash');

    await resetPassword('rawtoken64chars', 'NuevaPass123!');

    const revokeCall = query.mock.calls.find(
      ([sql]) => sql.includes('refresh_tokens') && sql.includes('revocado = true')
    );
    expect(revokeCall).toBeDefined();
    expect(revokeCall[1]).toEqual([mockUser.id]);
  });

  it('lanza 400 si el token no existe en la BD', async () => {
    query.mockResolvedValueOnce({ rows: [] });

    await expect(resetPassword('token-invalido', 'NuevaPass123!')).rejects.toMatchObject({
      status: 400,
    });
  });
});

// ─── Additional imports for new tests ─────────────────────────────────────────
import { verifyEmail, reenviarVerificacion, solicitarRecuperacion } from '../src/modules/auth/auth.service.js';
import { query } from '../src/config/database.js';

describe('verifyEmail()', () => {
  beforeEach(() => vi.clearAllMocks());

  it('retorna alreadyVerified=true si el email ya estaba verificado', async () => {
    query.mockResolvedValueOnce({ rows: [{ id: 'u1', nombre: 'Juan', email: 'j@j.co', email_verified: true, email_verification_expires: new Date() }] });
    const result = await verifyEmail('valid-token');
    expect(result.alreadyVerified).toBe(true);
  });

  it('lanza 400 si el token no existe en BD', async () => {
    query.mockResolvedValueOnce({ rows: [] });
    await expect(verifyEmail('bad-token')).rejects.toMatchObject({ status: 400 });
  });

  it('lanza 400 si el token está expirado', async () => {
    const expired = new Date(Date.now() - 3600000); // 1 hora atrás
    query.mockResolvedValueOnce({ rows: [{ id: 'u1', nombre: 'Juan', email: 'j@j.co', email_verified: false, email_verification_expires: expired }] });
    await expect(verifyEmail('expired-token')).rejects.toMatchObject({ status: 400, code: 'TOKEN_EXPIRED' });
  });

  it('verifica el email y retorna alreadyVerified=false', async () => {
    const future = new Date(Date.now() + 3600000);
    query
      .mockResolvedValueOnce({ rows: [{ id: 'u1', nombre: 'Juan', email: 'j@j.co', email_verified: false, email_verification_expires: future }] })
      .mockResolvedValueOnce({ rows: [{ id: 'u1' }] });
    const result = await verifyEmail('valid-token');
    expect(result.alreadyVerified).toBe(false);
    expect(result.email).toBe('j@j.co');
  });
});

describe('reenviarVerificacion()', () => {
  beforeEach(() => vi.clearAllMocks());

  it('retorna undefined si el usuario no existe', async () => {
    query.mockResolvedValueOnce({ rows: [] });
    const result = await reenviarVerificacion('no@existe.co');
    expect(result).toBeUndefined();
  });

  it('retorna undefined si el email ya está verificado', async () => {
    query.mockResolvedValueOnce({ rows: [{ id: 'u1', nombre: 'Juan', email: 'j@j.co', email_verified: true }] });
    const result = await reenviarVerificacion('j@j.co');
    expect(result).toBeUndefined();
  });

  it('genera nuevo token y retorna datos para enviar email', async () => {
    query
      .mockResolvedValueOnce({ rows: [{ id: 'u1', nombre: 'Juan', email: 'j@j.co', email_verified: false }] })
      .mockResolvedValueOnce({ rows: [] });
    const result = await reenviarVerificacion('j@j.co');
    expect(result).toHaveProperty('verificationToken');
    expect(result.email).toBe('j@j.co');
  });
});

describe('solicitarRecuperacion()', () => {
  beforeEach(() => vi.clearAllMocks());

  it('retorna null si el usuario no existe', async () => {
    query.mockResolvedValueOnce({ rows: [] });
    const result = await solicitarRecuperacion('no@existe.co');
    expect(result).toBeNull();
  });

  it('genera token de reset y retorna datos para enviar email', async () => {
    query
      .mockResolvedValueOnce({ rows: [{ id: 'u1', nombre: 'Juan', email: 'j@j.co', email_verified: true, activo: true }] })
      .mockResolvedValueOnce({ rows: [] });
    const result = await solicitarRecuperacion('j@j.co');
    expect(result).toHaveProperty('resetToken');
    expect(result.email).toBe('j@j.co');
  });
});

describe('login() — bloqueo por 5 intentos fallidos', () => {
  beforeEach(() => vi.clearAllMocks());

  it('bloquea la cuenta después de 5 intentos fallidos', async () => {
    const bcryptMock = (await import('bcryptjs')).default;
    bcryptMock.compare.mockResolvedValue(false);
    const userWith4Attempts = { ...mockUser, intentos_fallidos: 4 };
    query.mockResolvedValueOnce({ rows: [userWith4Attempts] }); // SELECT user
    query.mockResolvedValueOnce({ rows: [] }); // UPDATE intentos_fallidos (bloquear=true)

    await expect(login('admin@iiap.gob.pe', 'wrong', '127.0.0.1', 'jest'))
      .rejects.toMatchObject({ status: 401 });

    // Verificar que se bloquea con NULL reset en intentos y fecha de bloqueo
    const updateParams = query.mock.calls[1][1];
    expect(updateParams[0]).toBe(0); // bloquear ? 0 : nuevosIntentos
    expect(updateParams[1]).toBeInstanceOf(Date); // fecha de bloqueo
  });

  it('intentos_fallidos es null → usa 0 como base', async () => {
    const bcryptMock = (await import('bcryptjs')).default;
    bcryptMock.compare.mockResolvedValue(false);
    const userWithNullAttempts = { ...mockUser, intentos_fallidos: null };
    query.mockResolvedValueOnce({ rows: [userWithNullAttempts] });
    query.mockResolvedValueOnce({ rows: [] });

    await expect(login('admin@iiap.gob.pe', 'wrong', '127.0.0.1', 'jest'))
      .rejects.toMatchObject({ status: 401 });

    const updateParams = query.mock.calls[1][1];
    expect(updateParams[0]).toBe(1); // null ?? 0 + 1 = 1
  });

  it('rechaza el intento con 429 mientras la cuenta sigue bloqueada — no llega a comparar password', async () => {
    const bcryptMock = (await import('bcryptjs')).default;
    const bloqueadoHasta = new Date(Date.now() + 10 * 60_000); // 10 min en el futuro
    query.mockResolvedValueOnce({ rows: [{ ...mockUser, bloqueado_hasta: bloqueadoHasta }] });

    await expect(login('admin@iiap.gob.pe', 'cualquiera', '127.0.0.1', 'jest'))
      .rejects.toMatchObject({ status: 429, code: 'ACCOUNT_LOCKED' });

    expect(bcryptMock.compare).not.toHaveBeenCalled();
    expect(query).toHaveBeenCalledTimes(1); // solo el SELECT, ningún UPDATE
  });

  it('permite login normalmente si bloqueado_hasta ya pasó', async () => {
    const bcryptMock = (await import('bcryptjs')).default;
    bcryptMock.compare.mockResolvedValue(true);
    const bloqueadoHasta = new Date(Date.now() - 60_000); // 1 min en el pasado
    // rol 'publico' — fuera de EXPIRY_ROLES, así el test se enfoca solo en el bloqueo temporal
    query
      .mockResolvedValueOnce({ rows: [{ ...mockUser, rol: 'publico', bloqueado_hasta: bloqueadoHasta }] }) // SELECT
      .mockResolvedValueOnce({ rows: [] })   // UPDATE reset intentos
      .mockResolvedValueOnce({ rows: [{ totp_enabled: false }] }); // SELECT totp_enabled

    const result = await login('admin@iiap.gob.pe', 'correcta', '127.0.0.1', 'jest');
    expect(result.user.email).toBe(mockUser.email);
  });
});

describe('login() — expiración de contraseña', () => {
  beforeEach(() => vi.clearAllMocks());

  it('retorna passwordExpired=true y un token de cambio cuando la contraseña venció (rol admin_sig)', async () => {
    const bcryptMock = (await import('bcryptjs')).default;
    bcryptMock.compare.mockResolvedValue(true);
    const changedAt = new Date(Date.now() - 200 * 86_400_000); // hace 200 días
    query
      .mockResolvedValueOnce({ rows: [{ ...mockUser, password_changed_at: changedAt }] }) // SELECT user
      .mockResolvedValueOnce({ rows: [] })  // UPDATE reset intentos_fallidos
      .mockResolvedValueOnce({ rows: [] })  // SELECT configuracion passwordExpiryDays (vacío → default 90)
      .mockResolvedValueOnce({ rows: [] }); // UPDATE expired_token_jti

    const result = await login('admin@iiap.gob.pe', 'correcta', '127.0.0.1', 'jest');

    expect(result.passwordExpired).toBe(true);
    expect(result.expiredToken).toBe('mocked-token');
    expect(query).toHaveBeenCalledTimes(4);
  });

  it('NO exige cambio de contraseña si aún no venció el plazo configurado', async () => {
    const bcryptMock = (await import('bcryptjs')).default;
    bcryptMock.compare.mockResolvedValue(true);
    const changedAt = new Date(Date.now() - 5 * 86_400_000); // hace 5 días
    query
      .mockResolvedValueOnce({ rows: [{ ...mockUser, password_changed_at: changedAt }] })
      .mockResolvedValueOnce({ rows: [] })  // UPDATE reset intentos_fallidos
      .mockResolvedValueOnce({ rows: [] })  // SELECT configuracion passwordExpiryDays
      .mockResolvedValueOnce({ rows: [{ totp_enabled: false }] }); // SELECT totp_enabled

    const result = await login('admin@iiap.gob.pe', 'correcta', '127.0.0.1', 'jest');
    expect(result.passwordExpired).toBeUndefined();
    expect(result.user).toBeDefined();
  });

  it('no aplica expiración de contraseña a roles fuera de EXPIRY_ROLES (visitante)', async () => {
    const bcryptMock = (await import('bcryptjs')).default;
    bcryptMock.compare.mockResolvedValue(true);
    const changedAt = new Date(Date.now() - 500 * 86_400_000); // hace 500 días — vencería si aplicara
    query
      .mockResolvedValueOnce({ rows: [{ ...mockUser, rol: 'publico', password_changed_at: changedAt }] })
      .mockResolvedValueOnce({ rows: [] })  // UPDATE reset intentos_fallidos
      .mockResolvedValueOnce({ rows: [{ totp_enabled: false }] }); // SELECT totp_enabled (sin paso de expiración)

    const result = await login('admin@iiap.gob.pe', 'correcta', '127.0.0.1', 'jest');
    expect(result.passwordExpired).toBeUndefined();
    // Ninguna llamada debe consultar passwordExpiryDays — el rol no aplica a esa regla
    expect(query.mock.calls.some(([sql]) => sql.includes('passwordExpiryDays'))).toBe(false);
  });
});

describe('register() — perfilToRol branches', () => {
  beforeEach(() => vi.clearAllMocks());

  it('asigna rol "tecnico" cuando perfil es "tecnico"', async () => {
    const bcryptMock = (await import('bcryptjs')).default;
    bcryptMock.hash.mockResolvedValue('$2a$12$hashed');
    query.mockResolvedValueOnce({ rows: [] });
    query.mockResolvedValueOnce({ rows: [] }); // configuracion.requireApproval ausente
    query.mockResolvedValueOnce({ rows: [{ id: 'u1', nombre: 'T', email: 't@t.co', rol: 'tecnico' }] });
    await register({ nombre: 'T', email: 't@t.co', password: 'Pass!123', perfil: 'tecnico', motivo: 'x', tipoAcceso: 'externo' });
    const insertParams = query.mock.calls[2][1];
    expect(insertParams).toContain('tecnico');
  });

  it('asigna rol "institucional" cuando perfil es "institucional"', async () => {
    const bcryptMock = (await import('bcryptjs')).default;
    bcryptMock.hash.mockResolvedValue('$2a$12$hashed');
    query.mockResolvedValueOnce({ rows: [] });
    query.mockResolvedValueOnce({ rows: [] }); // configuracion.requireApproval ausente
    query.mockResolvedValueOnce({ rows: [{ id: 'u1', nombre: 'I', email: 'i@i.co', rol: 'institucional' }] });
    await register({ nombre: 'I', email: 'i@i.co', password: 'Pass!123', perfil: 'institucional', motivo: 'x', tipoAcceso: 'externo' });
    const insertParams = query.mock.calls[2][1];
    expect(insertParams).toContain('institucional');
  });
});

// ─── login() 2FA branch ───────────────────────────────────────────────────────
describe('login() — 2FA activo', () => {
  beforeEach(() => vi.clearAllMocks());

  it('retorna requiresTwoFactor=true cuando totp_enabled está activo', async () => {
    const bcryptMock = (await import('bcryptjs')).default;
    bcryptMock.compare.mockResolvedValueOnce(true);
    query
      .mockResolvedValueOnce({ rows: [{ ...mockUser }] })  // SELECT usuario
      .mockResolvedValueOnce({ rows: [] })                  // UPDATE last_login_at
      .mockResolvedValueOnce({ rows: [] })                  // SELECT configuracion (password expiry)
      .mockResolvedValueOnce({ rows: [{ totp_enabled: true }] }); // SELECT totp_enabled

    const { login } = await import('../src/modules/auth/auth.service.js');
    const result = await login(mockUser.email, 'Pass', '::1', 'agent');
    expect(result).toMatchObject({ requiresTwoFactor: true });
    expect(result.twoFactorToken).toBeTruthy();
  });
});

// ─── resetPassword() — token expirado ────────────────────────────────────────
describe('resetPassword() — token expirado', () => {
  beforeEach(() => vi.clearAllMocks());

  it('lanza 400 con code TOKEN_EXPIRED cuando la fecha de expiración pasó', async () => {
    const expired = new Date(Date.now() - 1000).toISOString();
    query.mockResolvedValueOnce({
      rows: [{ id: 'u1', email: 'test@test.co', password_reset_expires: expired }],
    });
    const { resetPassword } = await import('../src/modules/auth/auth.service.js');
    await expect(resetPassword('valid-token', 'NuevaPass123!')).rejects.toMatchObject({
      status: 400,
      code: 'TOKEN_EXPIRED',
    });
  });
});

// ─── refreshTokens() — caso exitoso ──────────────────────────────────────────
describe('refreshTokens() — rotación exitosa', () => {
  beforeEach(() => vi.clearAllMocks());

  it('rota el token y emite un nuevo par cuando el refresh token es válido', async () => {
    query
      .mockResolvedValueOnce({
        rows: [{ id: 'rt-1', usuario_id: 'u1', uid: 'u1', email: 'user@iiap.gob.pe', rol: 'investigador' }],
      })  // UPDATE principal — rotación exitosa
      .mockResolvedValueOnce({ rows: [] }); // INSERT del nuevo refresh token (issueTokenPair)

    const { refreshTokens } = await import('../src/modules/auth/auth.service.js');
    const result = await refreshTokens('valid-refresh-token', { ip: '::1', userAgent: 'chrome' });

    expect(result).toHaveProperty('accessToken');
    expect(result).toHaveProperty('refreshToken');
    expect(query).toHaveBeenCalledTimes(2);
  });
});

// ─── refreshTokens() — token robado ──────────────────────────────────────────
describe('refreshTokens() — token reutilizado (stolen)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('revoca sesiones y lanza 401 cuando detecta reutilización de token fuera de la ventana de gracia', async () => {
    const revocadoHaceRato = new Date(Date.now() - 60_000).toISOString(); // hace 60s — fuera de la ventana de 15s
    query
      .mockResolvedValueOnce({ rows: [] })  // UPDATE principal — sin filas (token inválido)
      .mockResolvedValueOnce({ rows: [{ usuario_id: 'u-victim', revocado_en: revocadoHaceRato }] }) // stolen check — revocado hace rato
      .mockResolvedValueOnce({ rows: [] }); // UPDATE revocación masiva

    const { refreshTokens } = await import('../src/modules/auth/auth.service.js');
    await expect(refreshTokens('stolen-token', { ip: '::1', userAgent: 'bot' }))
      .rejects.toMatchObject({ status: 401 });
    expect(query).toHaveBeenCalledTimes(3);
  });

  it('NO revoca toda la sesión si el token se reutiliza dentro de la ventana de gracia (carrera benigna: doble clic, reintento de red, dos pestañas)', async () => {
    const revocadoHaceInstantes = new Date(Date.now() - 500).toISOString(); // hace 500ms — dentro de la ventana de 15s
    query
      .mockResolvedValueOnce({ rows: [] })  // UPDATE principal — sin filas (ya rotado por la petición ganadora)
      .mockResolvedValueOnce({ rows: [{ usuario_id: 'u-victim', revocado_en: revocadoHaceInstantes }] }); // stolen check — revocado hace instantes

    const { refreshTokens } = await import('../src/modules/auth/auth.service.js');
    await expect(refreshTokens('stolen-token', { ip: '::1', userAgent: 'bot' }))
      .rejects.toMatchObject({ status: 401 });
    // Solo 2 queries — NO se ejecuta el UPDATE de revocación masiva de la familia completa
    expect(query).toHaveBeenCalledTimes(2);
  });
});
