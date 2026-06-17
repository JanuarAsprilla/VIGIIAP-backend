/**
 * Tests unitarios para admin.service.js
 * Mockea BD, bcryptjs, mailer y auditLog. Sin supertest. Sin conexión real.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../src/config/database.js', () => ({
  query: vi.fn(),
  getClient: vi.fn(),
}));

vi.mock('bcryptjs', () => ({
  default: {
    compare: vi.fn(),
    hash: vi.fn(),
  },
  compare: vi.fn(),
  hash: vi.fn(),
}));

vi.mock('../src/utils/mailer.js', () => ({
  notifyUsuarioCreado: vi.fn().mockResolvedValue(undefined),
  notifyUsuarioActivacion: vi.fn().mockResolvedValue(undefined),
  notifyAdminNewRegistro: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../src/utils/auditLog.js', () => ({
  registrarAuditoria: vi.fn(),
}));

import { query } from '../src/config/database.js';
import bcrypt from 'bcryptjs';
import { notifyUsuarioCreado, notifyUsuarioActivacion } from '../src/utils/mailer.js';
import { registrarAuditoria } from '../src/utils/auditLog.js';
import {
  crearUsuario,
  actualizarUsuario,
  eliminarUsuario,
  getConfiguracion,
  setConfiguracion,
  listarUsuarios,
} from '../src/modules/admin/admin.service.js';

// ─── Fixture ──────────────────────────────────────────────────────────────────
const ADMIN_CTX = { adminId: 'admin-uuid', adminEmail: 'admin@iiap.org.co' };

const USR = {
  id: 'usr-uuid-1',
  nombre: 'Investigador Test',
  email: 'inv@iiap.org.co',
  rol: 'investigador',
  institucion: 'IIAP',
  tipo_acceso: 'institucional',
  activo: true,
  creado_en: new Date().toISOString(),
};

// ─── listarUsuarios() ─────────────────────────────────────────────────────────
describe('admin.service → listarUsuarios()', () => {
  beforeEach(() => vi.clearAllMocks());

  it('retorna lista paginada de usuarios', async () => {
    query
      .mockResolvedValueOnce({ rows: [USR] })
      .mockResolvedValueOnce({ rows: [{ count: '1' }] });

    const result = await listarUsuarios({});
    expect(result.data).toHaveLength(1);
    expect(result.meta.total).toBe(1);
  });

  it('filtra por rol si es válido', async () => {
    query
      .mockResolvedValueOnce({ rows: [USR] })
      .mockResolvedValueOnce({ rows: [{ count: '1' }] });

    await listarUsuarios({ rol: 'investigador' });
    const params = query.mock.calls[0][1];
    expect(params).toContain('investigador');
  });

  it('busca por query string (q)', async () => {
    query
      .mockResolvedValueOnce({ rows: [USR] })
      .mockResolvedValueOnce({ rows: [{ count: '1' }] });

    await listarUsuarios({ q: 'Investigador' });
    const params = query.mock.calls[0][1];
    expect(params.some((p) => typeof p === 'string' && p.includes('Investigador'))).toBe(true);
  });
});

// ─── crearUsuario() ───────────────────────────────────────────────────────────
describe('admin.service → crearUsuario()', () => {
  beforeEach(() => vi.clearAllMocks());

  it('crea usuario con contraseña temporal y retorna el registro', async () => {
    query
      .mockResolvedValueOnce({ rows: [] })           // EXISTS check
      .mockResolvedValueOnce({ rows: [USR] });        // INSERT RETURNING

    bcrypt.hash.mockResolvedValueOnce('$2a$12$hashed');

    const result = await crearUsuario({
      nombre: 'Investigador Test',
      email: 'inv@iiap.org.co',
      rol: 'investigador',
      institucion: 'IIAP',
      ...ADMIN_CTX,
    });

    expect(result.id).toBe('usr-uuid-1');
    // _passwordTemporal debe estar presente en el resultado
    expect(result).toHaveProperty('_passwordTemporal');
    expect(typeof result._passwordTemporal).toBe('string');
    expect(result._passwordTemporal.length).toBeGreaterThan(0);
  });

  it('la contraseña temporal NO se guarda en texto plano (hash es llamado)', async () => {
    query
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [USR] });

    bcrypt.hash.mockResolvedValueOnce('$2a$12$hashed');

    const result = await crearUsuario({
      nombre: 'Alguien',
      email: 'alguien@iiap.org.co',
      rol: 'publico',
      ...ADMIN_CTX,
    });

    // bcrypt.hash debe haberse llamado
    expect(bcrypt.hash).toHaveBeenCalledOnce();
    // El INSERT no debe contener la contraseña en texto plano
    const insertCall = query.mock.calls[1];
    expect(insertCall[1]).not.toContain(result?._passwordTemporal);
  });

  it('lanza 409 si el email ya está registrado', async () => {
    query.mockResolvedValueOnce({ rows: [{ id: 'existing-id' }] }); // EXISTS check → ya existe

    await expect(
      crearUsuario({
        nombre: 'Duplicado',
        email: 'inv@iiap.org.co',
        rol: 'investigador',
        ...ADMIN_CTX,
      })
    ).rejects.toMatchObject({ status: 409 });

    // No debe llegar al INSERT
    expect(query).toHaveBeenCalledTimes(1);
    expect(bcrypt.hash).not.toHaveBeenCalled();
  });

  it('lanza 400 si el rol es inválido', async () => {
    await expect(
      crearUsuario({
        nombre: 'Alguien',
        email: 'x@iiap.org.co',
        rol: 'super_admin', // no está en ROLES de admin.service
        ...ADMIN_CTX,
      })
    ).rejects.toMatchObject({ status: 400 });

    expect(query).not.toHaveBeenCalled();
  });

  it('llama a notifyUsuarioCreado y registrarAuditoria tras crear', async () => {
    query
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [USR] });

    bcrypt.hash.mockResolvedValueOnce('$2a$12$hashed');

    await crearUsuario({
      nombre: 'Nuevo',
      email: 'nuevo@iiap.org.co',
      rol: 'investigador',
      ...ADMIN_CTX,
    });

    expect(notifyUsuarioCreado).toHaveBeenCalledOnce();
    expect(registrarAuditoria).toHaveBeenCalledOnce();
    expect(registrarAuditoria.mock.calls[0][0]).toMatchObject({
      accion: 'create_usuario',
    });
  });
});

// ─── actualizarUsuario() ──────────────────────────────────────────────────────
describe('admin.service → actualizarUsuario()', () => {
  beforeEach(() => vi.clearAllMocks());

  it('actualiza rol del usuario y retorna el registro', async () => {
    query
      .mockResolvedValueOnce({ rows: [{ rol: 'publico' }] })   // target check
      .mockResolvedValueOnce({ rows: [{ ...USR, rol: 'tecnico' }] }); // UPDATE

    const result = await actualizarUsuario({
      id: 'usr-uuid-1',
      rol: 'tecnico',
      ...ADMIN_CTX,
    });

    expect(result.rol).toBe('tecnico');
  });

  it('actualiza activo a false y llama a notifyUsuarioActivacion', async () => {
    query
      .mockResolvedValueOnce({ rows: [{ rol: 'investigador' }] })
      .mockResolvedValueOnce({ rows: [{ ...USR, activo: false }] });

    const result = await actualizarUsuario({
      id: 'usr-uuid-1',
      activo: false,
      ...ADMIN_CTX,
    });

    expect(result.activo).toBe(false);
    expect(notifyUsuarioActivacion).toHaveBeenCalledOnce();
  });

  it('lanza 403 si el target es super_admin', async () => {
    query.mockResolvedValueOnce({ rows: [{ rol: 'super_admin' }] });

    await expect(
      actualizarUsuario({ id: 'super-uuid', rol: 'publico', ...ADMIN_CTX })
    ).rejects.toMatchObject({ status: 403 });

    // No debe llegar al UPDATE
    expect(query).toHaveBeenCalledTimes(1);
  });

  it('lanza 400 si el rol proporcionado es inválido', async () => {
    await expect(
      actualizarUsuario({ id: 'usr-uuid-1', rol: 'super_admin', ...ADMIN_CTX })
    ).rejects.toMatchObject({ status: 400 });
  });

  it('lanza 404 si el usuario no existe (rows vacío en UPDATE)', async () => {
    query
      .mockResolvedValueOnce({ rows: [{ rol: 'publico' }] })
      .mockResolvedValueOnce({ rows: [] }); // UPDATE devuelve vacío

    await expect(
      actualizarUsuario({ id: 'no-existe', activo: true, ...ADMIN_CTX })
    ).rejects.toMatchObject({ status: 404 });
  });
});

// ─── eliminarUsuario() ────────────────────────────────────────────────────────
describe('admin.service → eliminarUsuario()', () => {
  beforeEach(() => vi.clearAllMocks());

  it('elimina un usuario normal y retorna el registro eliminado', async () => {
    query
      .mockResolvedValueOnce({ rows: [{ rol: 'investigador' }] }) // target check
      .mockResolvedValueOnce({ rows: [{ id: 'usr-uuid-1', nombre: 'Inv', email: 'inv@iiap.org.co' }] }); // DELETE

    const result = await eliminarUsuario({
      id: 'usr-uuid-1',
      ...ADMIN_CTX,
    });

    expect(result.id).toBe('usr-uuid-1');
    expect(registrarAuditoria).toHaveBeenCalledOnce();
  });

  it('lanza 403 si el target es super_admin', async () => {
    query.mockResolvedValueOnce({ rows: [{ rol: 'super_admin' }] });

    await expect(
      eliminarUsuario({ id: 'super-uuid', ...ADMIN_CTX })
    ).rejects.toMatchObject({ status: 403 });

    expect(query).toHaveBeenCalledTimes(1); // solo el target check
  });

  it('lanza 400 si el admin intenta eliminarse a sí mismo', async () => {
    await expect(
      eliminarUsuario({ id: 'admin-uuid', adminId: 'admin-uuid', adminEmail: 'admin@iiap.org.co' })
    ).rejects.toMatchObject({ status: 400 });

    expect(query).not.toHaveBeenCalled();
  });

  it('lanza 404 si el usuario no existe (DELETE retorna vacío)', async () => {
    query
      .mockResolvedValueOnce({ rows: [{ rol: 'publico' }] })
      .mockResolvedValueOnce({ rows: [] }); // DELETE sin filas

    await expect(
      eliminarUsuario({ id: 'no-existe', ...ADMIN_CTX })
    ).rejects.toMatchObject({ status: 404 });
  });
});

// ─── getConfiguracion() ───────────────────────────────────────────────────────
describe('admin.service → getConfiguracion()', () => {
  beforeEach(() => vi.clearAllMocks());

  it('retorna objeto clave→valor de la configuración', async () => {
    query.mockResolvedValueOnce({
      rows: [
        { clave: 'siteName', valor: 'VIGIIAP' },
        { clave: 'region', valor: 'Chocó Biogeográfico' },
      ],
    });

    const result = await getConfiguracion();
    expect(result).toEqual({ siteName: 'VIGIIAP', region: 'Chocó Biogeográfico' });
  });

  it('retorna objeto vacío si no hay configuración', async () => {
    query.mockResolvedValueOnce({ rows: [] });
    const result = await getConfiguracion();
    expect(result).toEqual({});
  });

  it('llama a la tabla configuracion ordenada por clave', async () => {
    query.mockResolvedValueOnce({ rows: [] });
    await getConfiguracion();
    const sql = query.mock.calls[0][0];
    expect(sql).toMatch(/configuracion/i);
    expect(sql).toMatch(/ORDER BY clave/i);
  });
});

// ─── setConfiguracion() ───────────────────────────────────────────────────────
describe('admin.service → setConfiguracion()', () => {
  beforeEach(() => vi.clearAllMocks());

  it('hace upsert por cada clave en el objeto de configuración', async () => {
    query.mockResolvedValue({ rows: [] });

    await setConfiguracion(
      { siteName: 'VIGIIAP', modoMantenimiento: 'false' },
      'admin-uuid',
      'admin@iiap.org.co'
    );

    // Se llama una vez por cada clave
    expect(query).toHaveBeenCalledTimes(2);
    const firstSql = query.mock.calls[0][0];
    expect(firstSql).toMatch(/INSERT INTO configuracion/i);
    expect(firstSql).toMatch(/ON CONFLICT/i);
  });

  it('registra auditoría al actualizar configuración', async () => {
    query.mockResolvedValue({ rows: [] });

    await setConfiguracion({ clave1: 'valor1' }, 'admin-uuid', 'admin@iiap.org.co');

    expect(registrarAuditoria).toHaveBeenCalledOnce();
    expect(registrarAuditoria.mock.calls[0][0]).toMatchObject({
      accion: 'update_configuracion',
    });
  });

  it('convierte valores a string antes de hacer upsert', async () => {
    query.mockResolvedValue({ rows: [] });

    await setConfiguracion({ activo: true, limite: 100 }, 'admin-uuid', 'admin@iiap.org.co');

    // Verificar que los params del upsert incluyen strings
    const params1 = query.mock.calls[0][1];
    expect(typeof params1[1]).toBe('string'); // valor convertido a string
  });

  it('no hace queries si el objeto de configuración está vacío', async () => {
    await setConfiguracion({}, 'admin-uuid', 'admin@iiap.org.co');
    expect(query).not.toHaveBeenCalled();
    // Pero sí llama a auditoría
    expect(registrarAuditoria).toHaveBeenCalledOnce();
  });
});
