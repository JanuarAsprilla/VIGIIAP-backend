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

  it('lanza 401 cuando el usuario no existe', async () => {
    query.mockResolvedValueOnce({ rows: [] });

    await expect(login('noexiste@iiap.gob.pe', 'pass', '127.0.0.1', 'jest')).rejects.toMatchObject({
      status: 401,
    });
    expect(bcrypt.compare).not.toHaveBeenCalled();
  });

  it('lanza 401 cuando la contraseña es incorrecta', async () => {
    query
      .mockResolvedValueOnce({ rows: [mockUser] })    // SELECT usuario
      .mockResolvedValueOnce({ rows: [] });            // UPDATE intentos_fallidos
    bcrypt.compare.mockResolvedValueOnce(false);

    await expect(login('admin@iiap.gob.pe', 'wrong', '127.0.0.1', 'jest')).rejects.toMatchObject({
      status: 401,
    });
    expect(registrarAuditoria).not.toHaveBeenCalled();
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
    // 2da query: INSERT → nuevo usuario
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
    // No debe llamar a INSERT
    expect(query).toHaveBeenCalledTimes(1);
  });

  it('asigna rol "publico" cuando el perfil no es reconocido', async () => {
    query.mockResolvedValueOnce({ rows: [] });
    query.mockResolvedValueOnce({
      rows: [{ id: 'uuid-003', nombre: 'Test', email: 'test@test.com', rol: 'publico' }],
    });
    bcrypt.hash.mockResolvedValueOnce('$2a$12$hashed');

    await register({ ...validData, perfil: 'desconocido' });

    // El segundo query (INSERT) debe haber sido llamado con rol 'publico'
    const insertParams = query.mock.calls[1][1];
    expect(insertParams[5]).toBe('publico'); // índice 5 = rol en el array de params
  });

  it('normaliza email a minúsculas antes de insertar', async () => {
    query.mockResolvedValueOnce({ rows: [] });
    query.mockResolvedValueOnce({
      rows: [{ id: 'uuid-004', nombre: 'Test', email: 'upper@test.com', rol: 'investigador' }],
    });
    bcrypt.hash.mockResolvedValueOnce('$2a$12$hashed');

    await register({ ...validData, email: 'UPPER@TEST.COM' });

    expect(query.mock.calls[0][1]).toEqual(['upper@test.com']);
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
      creado_en: new Date().toISOString(),
    };
    query.mockResolvedValueOnce({ rows: [profileRow] });

    const result = await getProfile('uuid-001');

    expect(result).toMatchObject({ id: 'uuid-001', email: 'admin@iiap.gob.pe' });
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining('WHERE id = $1'),
      ['uuid-001']
    );
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
});

describe('register() — perfilToRol branches', () => {
  beforeEach(() => vi.clearAllMocks());

  it('asigna rol "tecnico" cuando perfil es "tecnico"', async () => {
    const bcryptMock = (await import('bcryptjs')).default;
    bcryptMock.hash.mockResolvedValue('$2a$12$hashed');
    query.mockResolvedValueOnce({ rows: [] });
    query.mockResolvedValueOnce({ rows: [{ id: 'u1', nombre: 'T', email: 't@t.co', rol: 'tecnico' }] });
    await register({ nombre: 'T', email: 't@t.co', password: 'Pass!123', perfil: 'tecnico', motivo: 'x', tipoAcceso: 'externo' });
    const insertParams = query.mock.calls[1][1];
    expect(insertParams).toContain('tecnico');
  });

  it('asigna rol "institucional" cuando perfil es "institucional"', async () => {
    const bcryptMock = (await import('bcryptjs')).default;
    bcryptMock.hash.mockResolvedValue('$2a$12$hashed');
    query.mockResolvedValueOnce({ rows: [] });
    query.mockResolvedValueOnce({ rows: [{ id: 'u1', nombre: 'I', email: 'i@i.co', rol: 'institucional' }] });
    await register({ nombre: 'I', email: 'i@i.co', password: 'Pass!123', perfil: 'institucional', motivo: 'x', tipoAcceso: 'externo' });
    const insertParams = query.mock.calls[1][1];
    expect(insertParams).toContain('institucional');
  });
});
