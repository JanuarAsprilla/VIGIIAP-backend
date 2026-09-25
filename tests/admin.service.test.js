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
  notifyRolCambiado: vi.fn().mockResolvedValue(undefined),
  notifyCambioConfigCritica: vi.fn().mockResolvedValue(undefined),
  clearMailConfigCache: vi.fn(),
}));

vi.mock('../src/utils/auditLog.js', () => ({
  registrarAuditoria: vi.fn(),
}));

import { query } from '../src/config/database.js';
import bcrypt from 'bcryptjs';
import { notifyUsuarioCreado, notifyUsuarioActivacion, notifyCambioConfigCritica } from '../src/utils/mailer.js';
import { registrarAuditoria } from '../src/utils/auditLog.js';
import {
  crearUsuario,
  actualizarUsuario,
  eliminarUsuario,
  getConfiguracion,
  setConfiguracion,
  listarUsuarios,
  listarAdministradores,
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

  it('excluye admin_sig y super_admin — tienen su propia vista dedicada', async () => {
    query
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ count: '0' }] });

    await listarUsuarios({});
    const sql = query.mock.calls[0][0];
    expect(sql).toMatch(/rol NOT IN \('super_admin', 'admin_sig'\)/);
  });

  it('ignora rol=admin_sig como filtro — no es un rol asignable desde este listado', async () => {
    query
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ count: '0' }] });

    await listarUsuarios({ rol: 'admin_sig' });
    const params = query.mock.calls[0][1];
    expect(params).not.toContain('admin_sig');
  });

  it('incluye rol_solicitado — para que el admin vea solicitudes de rol pendientes de cuentas OAuth', async () => {
    query
      .mockResolvedValueOnce({ rows: [USR] })
      .mockResolvedValueOnce({ rows: [{ count: '1' }] });

    await listarUsuarios({});
    const sql = query.mock.calls[0][0];
    expect(sql).toMatch(/rol_solicitado AS "rolSolicitado"/);
  });
});

// ─── listarAdministradores() ──────────────────────────────────────────────────
describe('admin.service → listarAdministradores()', () => {
  beforeEach(() => vi.clearAllMocks());

  it('retorna solo admin_sig, con sus permisos por módulo embebidos', async () => {
    query
      .mockResolvedValueOnce({
        rows: [{ id: 'a1', nombre: 'Admin Uno', email: 'a1@iiap.org.co', activo: true, permisos: [{ modulo: 'mapas', puede_ver: true, puede_editar: true }] }],
      })
      .mockResolvedValueOnce({ rows: [{ count: '1' }] });

    const result = await listarAdministradores({});
    expect(result.data).toHaveLength(1);
    expect(result.data[0].permisos).toEqual([{ modulo: 'mapas', puede_ver: true, puede_editar: true }]);
    const sql = query.mock.calls[0][0];
    expect(sql).toMatch(/rol = 'admin_sig'/);
  });

  it('filtra por activo', async () => {
    query
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ count: '0' }] });

    await listarAdministradores({ activo: 'false' });
    const params = query.mock.calls[0][1];
    expect(params).toContain(false);
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

  it('lanza 400 con rol admin_sig — crearUsuario nunca crea administradores, ni siquiera para super_admin', async () => {
    await expect(
      crearUsuario({
        nombre: 'Escalado',
        email: 'escalado@iiap.org.co',
        rol: 'admin_sig',
        adminId: 'admin-uuid',
        adminRol: 'admin_sig',
        adminEmail: 'admin@iiap.org.co',
      })
    ).rejects.toMatchObject({ status: 400 });
    expect(query).not.toHaveBeenCalled();

    await expect(
      crearUsuario({
        nombre: 'Nuevo Admin',
        email: 'nuevoadmin@iiap.org.co',
        rol: 'admin_sig',
        adminId: 'super-uuid',
        adminRol: 'super_admin',
        adminEmail: 'super@iiap.org.co',
      })
    ).rejects.toMatchObject({ status: 400 });
    // Crear administradores va exclusivamente por crearAdminSig() (POST /admin/super/crear-admin)
    expect(query).not.toHaveBeenCalled();
  });
});

// ─── actualizarUsuario() ──────────────────────────────────────────────────────
describe('admin.service → actualizarUsuario()', () => {
  beforeEach(() => vi.clearAllMocks());

  it('actualiza rol del usuario y retorna el registro', async () => {
    query
      .mockResolvedValueOnce({ rows: [{ rol: 'publico' }] })         // target check
      .mockResolvedValueOnce({ rows: [{ ...USR, rol: 'tecnico' }] }) // UPDATE usuario
      .mockResolvedValueOnce({ rows: [] });                            // revokeAllRefreshTokens

    const result = await actualizarUsuario({
      id: 'usr-uuid-1',
      rol: 'tecnico',
      ...ADMIN_CTX,
    });

    expect(result.rol).toBe('tecnico');
  });

  it('al cambiar el rol, limpia rol_solicitado — resuelve cualquier solicitud pendiente de la cuenta', async () => {
    query
      .mockResolvedValueOnce({ rows: [{ rol: 'publico' }] })
      .mockResolvedValueOnce({ rows: [{ ...USR, rol: 'investigador' }] })
      .mockResolvedValueOnce({ rows: [] });

    await actualizarUsuario({ id: 'usr-uuid-1', rol: 'investigador', ...ADMIN_CTX });

    const updateSql = query.mock.calls[1][0];
    expect(updateSql).toMatch(/rol_solicitado = NULL/);
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

  it('lanza 400 si el admin intenta modificar su propia cuenta desde el panel', async () => {
    await expect(
      actualizarUsuario({ id: 'admin-uuid', rol: 'investigador', ...ADMIN_CTX })
    ).rejects.toMatchObject({ status: 400 });
    expect(query).not.toHaveBeenCalled();
  });

  it('lanza 403 si un admin_sig intenta modificar a otro admin_sig existente', async () => {
    query.mockResolvedValueOnce({ rows: [{ rol: 'admin_sig' }] });

    await expect(
      actualizarUsuario({ id: 'otro-admin-uuid', activo: false, ...ADMIN_CTX })
    ).rejects.toMatchObject({ status: 403 });
    expect(query).toHaveBeenCalledTimes(1); // no llega al UPDATE
  });

  it('lanza 403 si un admin_sig intenta asignar el rol admin_sig', async () => {
    query.mockResolvedValueOnce({ rows: [{ rol: 'publico' }] });

    await expect(
      actualizarUsuario({ id: 'usr-uuid-1', rol: 'admin_sig', ...ADMIN_CTX })
    ).rejects.toMatchObject({ status: 403 });
  });

  it('super_admin sí puede modificar una cuenta admin_sig existente', async () => {
    query
      .mockResolvedValueOnce({ rows: [{ rol: 'admin_sig' }] })            // target check
      .mockResolvedValueOnce({ rows: [{ ...USR, rol: 'admin_sig', activo: false }] }); // UPDATE

    const result = await actualizarUsuario({
      id: 'otro-admin-uuid',
      activo: false,
      adminId: 'super-uuid',
      adminRol: 'super_admin',
      adminEmail: 'super@iiap.org.co',
    });

    expect(result.activo).toBe(false);
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

  it('lanza 403 si un admin_sig intenta eliminar a otro admin_sig', async () => {
    query.mockResolvedValueOnce({ rows: [{ rol: 'admin_sig' }] });

    await expect(
      eliminarUsuario({ id: 'otro-admin-uuid', ...ADMIN_CTX })
    ).rejects.toMatchObject({ status: 403 });

    expect(query).toHaveBeenCalledTimes(1); // no llega al DELETE
  });

  it('super_admin sí puede eliminar una cuenta admin_sig', async () => {
    query
      .mockResolvedValueOnce({ rows: [{ rol: 'admin_sig' }] })
      .mockResolvedValueOnce({ rows: [{ id: 'otro-admin-uuid', nombre: 'Admin', email: 'admin2@iiap.org.co' }] });

    const result = await eliminarUsuario({
      id: 'otro-admin-uuid',
      adminId: 'super-uuid',
      adminRol: 'super_admin',
      adminEmail: 'super@iiap.org.co',
    });

    expect(result.id).toBe('otro-admin-uuid');
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

    // 2 upserts + 1 SELECT de emails de super_admin (modoMantenimiento es
    // una clave crítica — dispara la alerta, ver describe de más abajo)
    expect(query).toHaveBeenCalledTimes(3);
    const firstSql = query.mock.calls[0][0];
    expect(firstSql).toMatch(/INSERT INTO configuracion/i);
    expect(firstSql).toMatch(/ON CONFLICT/i);
  });

  it('avisa a cada super_admin activo cuando se cambia una clave crítica (modoMantenimiento)', async () => {
    query.mockImplementation((sql) => {
      if (/SELECT email FROM usuarios WHERE rol = 'super_admin'/.test(sql)) {
        return Promise.resolve({ rows: [{ email: 'super1@iiap.org.co' }, { email: 'super2@iiap.org.co' }] });
      }
      return Promise.resolve({ rows: [] });
    });

    await setConfiguracion({ modoMantenimiento: 'true' }, 'admin-uuid', 'admin@iiap.org.co');

    expect(notifyCambioConfigCritica).toHaveBeenCalledTimes(2);
    expect(notifyCambioConfigCritica).toHaveBeenCalledWith(
      expect.objectContaining({ email: 'super1@iiap.org.co', adminEmail: 'admin@iiap.org.co' }),
    );
    expect(notifyCambioConfigCritica).toHaveBeenCalledWith(
      expect.objectContaining({ email: 'super2@iiap.org.co' }),
    );
  });

  it('no avisa a nadie cuando solo cambian claves rutinarias (siteName)', async () => {
    query.mockResolvedValue({ rows: [] });
    await setConfiguracion({ siteName: 'VIGIIAP' }, 'admin-uuid', 'admin@iiap.org.co');
    expect(notifyCambioConfigCritica).not.toHaveBeenCalled();
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

// ─── Additional imports ────────────────────────────────────────────────────
import { getAuditLog, getErrorLog, actualizarEstadoError, getSuperStats, crearAdminSig, getAdminEmails } from '../src/modules/admin/admin.service.js';
import { query } from '../src/config/database.js';

describe('admin.service → getAuditLog()', () => {
  beforeEach(() => vi.clearAllMocks());

  it('retorna log paginado sin filtros', async () => {
    query
      .mockResolvedValueOnce({ rows: [{ id: 'log1', accion: 'login' }] })
      .mockResolvedValueOnce({ rows: [{ count: '1' }] });
    const result = await getAuditLog({});
    expect(result.data).toHaveLength(1);
    expect(result.meta.total).toBe(1);
  });

  it('filtra por modulo cuando se pasa', async () => {
    query
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ count: '0' }] });
    const result = await getAuditLog({ modulo: 'mapas' });
    const params = query.mock.calls[0][1];
    expect(params).toContain('mapas');
    expect(result.data).toHaveLength(0);
  });

  it('filtra por accion cuando se pasa', async () => {
    query
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ count: '0' }] });
    await getAuditLog({ accion: 'login' });
    const params = query.mock.calls[0][1];
    expect(params).toContain('login');
  });

  it('filtra por rango de fechas cuando se pasan fechaDesde/fechaHasta', async () => {
    query
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ count: '0' }] });
    await getAuditLog({ fechaDesde: '2026-01-01', fechaHasta: '2026-01-31' });
    const [sql, params] = query.mock.calls[0];
    expect(sql).toMatch(/creado_en >= \$\d+/);
    expect(sql).toMatch(/creado_en <= \$\d+/);
    expect(params).toEqual(expect.arrayContaining(['2026-01-01', '2026-01-31']));
  });

  it('busca por descripcion/usuario_email/accion cuando se pasa q', async () => {
    query
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ count: '0' }] });
    await getAuditLog({ q: 'ana@iiap' });
    const [sql, params] = query.mock.calls[0];
    expect(sql).toMatch(/ILIKE/);
    expect(params).toContain('%ana@iiap%');
  });

  it('rechaza una búsqueda demasiado larga', async () => {
    await expect(getAuditLog({ q: 'x'.repeat(201) })).rejects.toMatchObject({ status: 400 });
  });

  // Regresión de accountability: antes NADIE (ni siquiera otro super_admin)
  // podía ver la actividad de una cuenta super_admin en el log -- si esa
  // cuenta se veía comprometida o hacía algo indebido, quedaba invisible
  // para todos, incluido quien más autoridad tiene para actuar sobre eso.
  it('sin viewerRol (u otro rol), excluye la actividad de cuentas super_admin', async () => {
    query
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ count: '0' }] });
    await getAuditLog({}, 'admin_sig');
    const sql = query.mock.calls[0][0];
    expect(sql).toMatch(/usuario_id NOT IN \(SELECT id FROM usuarios WHERE rol = 'super_admin'\)/);
  });

  it('cuando viewerRol es super_admin, NO excluye la actividad de otras cuentas super_admin', async () => {
    query
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ count: '0' }] });
    await getAuditLog({}, 'super_admin');
    const sql = query.mock.calls[0][0];
    expect(sql).not.toMatch(/super_admin/);
  });
});

describe('admin.service → getErrorLog()', () => {
  beforeEach(() => vi.clearAllMocks());

  it('retorna el registro de errores paginado, más recientes primero', async () => {
    query
      .mockResolvedValueOnce({ rows: [{ id: 1, mensaje: 'boom', ocurrencias: 3 }] })
      .mockResolvedValueOnce({ rows: [{ count: '1' }] });
    const result = await getErrorLog({});
    expect(result.data).toHaveLength(1);
    expect(result.meta.total).toBe(1);
    expect(query.mock.calls[0][0]).toContain('ORDER BY ultima_vez DESC');
  });

  it('incluye el estado de seguimiento en la selección', async () => {
    query
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ count: '0' }] });
    await getErrorLog({});
    expect(query.mock.calls[0][0]).toContain('estado, estado_actualizado_en, estado_actualizado_por');
  });
});

describe('admin.service → actualizarEstadoError()', () => {
  beforeEach(() => vi.clearAllMocks());

  it('actualiza el estado y devuelve la fila actualizada', async () => {
    query.mockResolvedValueOnce({ rows: [{ id: 7, estado: 'revisando' }] });
    const result = await actualizarEstadoError(7, 'revisando', 'admin@iiap.org.co');

    expect(result).toEqual({ id: 7, estado: 'revisando' });
    expect(query.mock.calls[0][0]).toContain('UPDATE error_log');
    expect(query.mock.calls[0][1]).toEqual(['revisando', 'admin@iiap.org.co', 7]);
  });

  it('rechaza un estado que no está en el enum permitido, sin llegar a la BD', async () => {
    await expect(actualizarEstadoError(7, 'archivado', 'admin@iiap.org.co'))
      .rejects.toMatchObject({ status: 400 });
    expect(query).not.toHaveBeenCalled();
  });

  it('lanza 404 cuando el id no existe', async () => {
    query.mockResolvedValueOnce({ rows: [] });
    await expect(actualizarEstadoError(999, 'resuelto', 'admin@iiap.org.co'))
      .rejects.toMatchObject({ status: 404 });
  });
});

describe('admin.service → getSuperStats()', () => {
  beforeEach(() => vi.clearAllMocks());

  it('retorna estadísticas de usuarios por rol', async () => {
    query.mockResolvedValueOnce({ rows: [{ total_usuarios: '100', admins: '5', investigadores: '20' }] });
    const result = await getSuperStats();
    expect(result).toHaveProperty('total_usuarios');
  });
});

describe('admin.service → getAdminEmails()', () => {
  beforeEach(() => vi.clearAllMocks());

  it('retorna lista de emails de admins activos', async () => {
    query.mockResolvedValueOnce({ rows: [{ email: 'admin@iiap.org.co' }] });
    const result = await getAdminEmails();
    expect(result).toContain('admin@iiap.org.co');
  });

  it('retorna lista vacía si no hay admins', async () => {
    query.mockResolvedValueOnce({ rows: [] });
    const result = await getAdminEmails();
    expect(result).toEqual([]);
  });

  it('agrega los emails de ADMIN_EMAIL (separados por coma) sin duplicar los de BD', async () => {
    const original = process.env.ADMIN_EMAIL;
    process.env.ADMIN_EMAIL = 'admin@iiap.org.co, backup@iiap.org.co ,';
    try {
      query.mockResolvedValueOnce({ rows: [{ email: 'admin@iiap.org.co' }] });
      const result = await getAdminEmails();
      expect(result).toEqual(['admin@iiap.org.co', 'backup@iiap.org.co']);
    } finally {
      if (original === undefined) delete process.env.ADMIN_EMAIL;
      else process.env.ADMIN_EMAIL = original;
    }
  });
});

describe('admin.service → crearAdminSig()', () => {
  beforeEach(() => vi.clearAllMocks());

  it('crea un admin_sig con password temporal y retorna el registro', async () => {
    const bcryptMock = (await import('bcryptjs')).default;
    bcryptMock.hash.mockResolvedValue('hashed_password');
    query
      .mockResolvedValueOnce({ rows: [] }) // Check email duplicado
      .mockResolvedValueOnce({ rows: [{ id: 'a1', nombre: 'Admin', email: 'a@a.co', rol: 'admin_sig' }] }); // INSERT
    const result = await crearAdminSig({ nombre: 'Admin', email: 'a@a.co', superAdminId: 's1' });

    expect(result.rol).toBe('admin_sig');
    expect(result.email).toBe('a@a.co');
    // La contraseña temporal se hashea antes de insertarse — nunca en texto plano
    expect(bcryptMock.hash).toHaveBeenCalledWith(expect.any(String), 12);
    const insertSql = query.mock.calls[1][0];
    expect(insertSql).toMatch(/'admin_sig'/); // rol hardcoded en el SQL, no viene del input
    expect(registrarAuditoria).toHaveBeenCalledWith(
      expect.objectContaining({ accion: 'create_admin', usuarioId: 's1' })
    );
  });
});

describe('admin.service → listarUsuarios() — filtro activo', () => {
  beforeEach(() => vi.clearAllMocks());

  it('filtra por activo=true', async () => {
    query
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ count: '0' }] });
    await listarUsuarios({ activo: 'true' });
    const params = query.mock.calls[0][1];
    expect(params).toContain(true);
  });

  it('filtra por activo=false', async () => {
    query
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ count: '0' }] });
    await listarUsuarios({ activo: 'false' });
    const params = query.mock.calls[0][1];
    expect(params).toContain(false);
  });

  it('combina filtros rol + activo + q', async () => {
    query
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ count: '0' }] });
    await listarUsuarios({ rol: 'investigador', activo: 'true', q: 'Juan' });
    const sql = query.mock.calls[0][0];
    expect(sql).toMatch(/WHERE/);
  });
});

describe('admin.service → crearAdminSig() — email duplicado', () => {
  beforeEach(() => vi.clearAllMocks());

  it('lanza 409 si el email ya existe', async () => {
    query.mockResolvedValueOnce({ rows: [{ id: 'existing-u1' }] });
    await expect(
      crearAdminSig({ nombre: 'Admin', email: 'a@a.co', superAdminId: 's1' })
    ).rejects.toMatchObject({ status: 409 });
  });
});

describe('admin.service → crearUsuario() — branches adicionales', () => {
  beforeEach(() => vi.clearAllMocks());

  it('lanza 400 si el rol es inválido', async () => {
    await expect(
      crearUsuario({ nombre: 'X', email: 'x@x.co', rol: 'rol_inventado', adminId: 'a1', adminEmail: 'a@a.co' })
    ).rejects.toMatchObject({ status: 400 });
    expect(query).not.toHaveBeenCalled();
  });

  it('lanza 409 si el email ya existe', async () => {
    query.mockResolvedValueOnce({ rows: [{ id: 'u1' }] });
    await expect(
      crearUsuario({ nombre: 'X', email: 'dup@x.co', rol: 'investigador', adminId: 'a1', adminEmail: 'a@a.co' })
    ).rejects.toMatchObject({ status: 409 });
  });
});

describe('admin.service → actualizarUsuario() — branches', () => {
  beforeEach(() => vi.clearAllMocks());

  it('lanza 400 si el rol es inválido', async () => {
    await expect(
      actualizarUsuario({ id: 'u1', rol: 'rol_inventado', adminId: 'a1', adminEmail: 'a@a.co' })
    ).rejects.toMatchObject({ status: 400 });
  });
});
