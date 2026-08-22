/**
 * Tests directos para admin.controller.js — funciones con 0% de cobertura.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../src/modules/admin/admin.service.js', () => ({
  getNotificaciones:  vi.fn(),
  getConfiguracion:   vi.fn(),
  setConfiguracion:   vi.fn(),
  listarUsuarios:     vi.fn(),
  crearUsuario:       vi.fn(),
  actualizarUsuario:  vi.fn(),
  eliminarUsuario:    vi.fn(),
  getAuditLog:        vi.fn(),
  getSuperStats:      vi.fn(),
  crearAdminSig:      vi.fn(),
}));

vi.mock('../src/config/database.js', () => ({
  query: vi.fn().mockResolvedValue({ rows: [{ count: '5' }] }),
  getClient: vi.fn(),
}));

vi.mock('../src/utils/dataCustody.js', () => ({
  getCadenaCustodia:    vi.fn().mockResolvedValue([]),
  getDescargasRecurso:  vi.fn().mockResolvedValue([]),
  ACCION: {},
  registrarCustodia:    vi.fn(),
  registrarDescarga:    vi.fn(),
  registrarScanArchivo: vi.fn(),
}));

vi.mock('../src/utils/auditLog.js', () => ({
  registrarAuditoria: vi.fn(),
}));

vi.mock('../src/utils/mailer.js', () => ({
  notifyUsuarioActivacion: vi.fn().mockResolvedValue(undefined),
  notifyRolCambiado:       vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../src/modules/auth/auth.service.js', () => ({
  revokeAllRefreshTokens: vi.fn().mockResolvedValue(undefined),
}));

import * as adminService from '../src/modules/admin/admin.service.js';
import { query } from '../src/config/database.js';
import { getCadenaCustodia, getDescargasRecurso } from '../src/utils/dataCustody.js';
import { registrarAuditoria } from '../src/utils/auditLog.js';
import { notifyUsuarioActivacion, notifyRolCambiado } from '../src/utils/mailer.js';
import { revokeAllRefreshTokens } from '../src/modules/auth/auth.service.js';
import {
  notificaciones, getConfiguracion, setConfiguracion, stats, resetStatsCache,
  listarUsuarios, crearUsuario, actualizarUsuario, eliminarUsuario,
  auditLog, superStats, crearAdmin, custodiaRecurso, descargasRecurso,
  descargasStats, scanLog, batchUsuarios,
} from '../src/modules/admin/admin.controller.js';

const mockNext = vi.fn();
const ADMIN = { id: 'uuid-admin', email: 'admin@iiap.org.co', rol: 'admin_sig' };
const SUPERADMIN = { id: 'uuid-super', email: 'super@iiap.org.co', rol: 'super_admin', ip: '127.0.0.1' };
const TARGET_1 = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';
const TARGET_2 = 'b2c3d4e5-f6a7-8901-bcde-f01234567891';
const SUPER_TARGET = 'c3d4e5f6-a7b8-9012-cdef-012345678912';

function res() {
  return { status: vi.fn().mockReturnThis(), json: vi.fn(), end: vi.fn() };
}

// ── notificaciones() ──────────────────────────────────────────────────────

describe('admin.controller → notificaciones()', () => {
  beforeEach(() => vi.clearAllMocks());

  it('retorna las notificaciones del servicio', async () => {
    adminService.getNotificaciones.mockResolvedValue([{ id: 1 }]);
    const r = res();
    await notificaciones({}, r, mockNext);
    expect(r.json).toHaveBeenCalledWith([{ id: 1 }]);
  });

  it('llama next(err) si el servicio lanza', async () => {
    adminService.getNotificaciones.mockRejectedValue(new Error('db'));
    await notificaciones({}, res(), mockNext);
    expect(mockNext).toHaveBeenCalledWith(expect.any(Error));
  });
});

// ── getConfiguracion() ────────────────────────────────────────────────────

describe('admin.controller → getConfiguracion()', () => {
  beforeEach(() => vi.clearAllMocks());

  it('retorna la configuración', async () => {
    adminService.getConfiguracion.mockResolvedValue({ siteName: 'VIGIIAP' });
    const r = res();
    await getConfiguracion({}, r, mockNext);
    expect(r.json).toHaveBeenCalledWith({ siteName: 'VIGIIAP' });
  });

  it('llama next(err) si el servicio lanza', async () => {
    adminService.getConfiguracion.mockRejectedValue(new Error('db'));
    await getConfiguracion({}, res(), mockNext);
    expect(mockNext).toHaveBeenCalledWith(expect.any(Error));
  });
});

// ── setConfiguracion() ────────────────────────────────────────────────────

describe('admin.controller → setConfiguracion()', () => {
  beforeEach(() => vi.clearAllMocks());

  it('retorna 400 si body es null', async () => {
    const r = res();
    await setConfiguracion({ body: null, user: ADMIN }, r, mockNext);
    expect(r.status).toHaveBeenCalledWith(400);
  });

  it('retorna 400 si body es array', async () => {
    const r = res();
    await setConfiguracion({ body: [], user: ADMIN }, r, mockNext);
    expect(r.status).toHaveBeenCalledWith(400);
  });

  it('retorna 400 con claves no permitidas', async () => {
    const r = res();
    await setConfiguracion({ body: { claveRara: 'x' }, user: ADMIN }, r, mockNext);
    expect(r.status).toHaveBeenCalledWith(400);
    expect(r.json.mock.calls[0][0].error).toMatch(/no permitidas/i);
  });

  it('retorna 400 si booleano recibe un string inválido', async () => {
    const r = res();
    await setConfiguracion({ body: { modoMantenimiento: 'si' }, user: ADMIN }, r, mockNext);
    expect(r.status).toHaveBeenCalledWith(400);
  });

  it('retorna 400 si string supera maxLength', async () => {
    const r = res();
    await setConfiguracion({ body: { siteName: 'x'.repeat(101) }, user: ADMIN }, r, mockNext);
    expect(r.status).toHaveBeenCalledWith(400);
  });

  it('retorna 400 si valor de campo string no es string', async () => {
    const r = res();
    await setConfiguracion({ body: { siteName: 123 }, user: ADMIN }, r, mockNext);
    expect(r.status).toHaveBeenCalledWith(400);
  });

  it('guarda configuración válida y responde con mensaje', async () => {
    adminService.setConfiguracion.mockResolvedValue(undefined);
    const r = res();
    await setConfiguracion({ body: { siteName: 'VIGIIAP' }, user: ADMIN }, r, mockNext);
    expect(adminService.setConfiguracion).toHaveBeenCalledOnce();
    expect(r.json).toHaveBeenCalledWith({ message: expect.any(String) });
  });

  it('acepta booleano true como modoMantenimiento', async () => {
    adminService.setConfiguracion.mockResolvedValue(undefined);
    const r = res();
    await setConfiguracion({ body: { modoMantenimiento: true }, user: ADMIN }, r, mockNext);
    expect(r.json).toHaveBeenCalledWith({ message: expect.any(String) });
  });

  it('llama next(err) si el servicio lanza', async () => {
    adminService.setConfiguracion.mockRejectedValue(new Error('db'));
    await setConfiguracion({ body: { siteName: 'X' }, user: ADMIN }, res(), mockNext);
    expect(mockNext).toHaveBeenCalledWith(expect.any(Error));
  });
});

// ── stats() ───────────────────────────────────────────────────────────────

describe('admin.controller → stats()', () => {
  beforeEach(() => { vi.clearAllMocks(); resetStatsCache(); });

  it('retorna objeto de estadísticas', async () => {
    query.mockResolvedValue({ rows: [{ count: '10' }] });
    const r = res();
    await stats({}, r, mockNext);
    const body = r.json.mock.calls[0][0];
    expect(body).toHaveProperty('usuarios');
    expect(body).toHaveProperty('solicitudesPendientes');
  });

  it('llama next(err) si query lanza', async () => {
    query.mockRejectedValue(new Error('db'));
    await stats({}, res(), mockNext);
    expect(mockNext).toHaveBeenCalledWith(expect.any(Error));
  });

  it('retorna la respuesta cacheada sin volver a consultar la BD dentro de 30s', async () => {
    query.mockResolvedValue({ rows: [{ count: '10' }] });
    const r1 = res();
    await stats({}, r1, mockNext);
    expect(query).toHaveBeenCalled();

    query.mockClear();
    const r2 = res();
    await stats({}, r2, mockNext);
    expect(query).not.toHaveBeenCalled();
    expect(r2.json).toHaveBeenCalledWith(r1.json.mock.calls[0][0]);
  });
});

// ── listarUsuarios() ──────────────────────────────────────────────────────

describe('admin.controller → listarUsuarios()', () => {
  beforeEach(() => vi.clearAllMocks());

  it('delega al servicio y retorna el resultado', async () => {
    adminService.listarUsuarios.mockResolvedValue({ data: [], meta: {} });
    const r = res();
    await listarUsuarios({ query: {} }, r, mockNext);
    expect(r.json).toHaveBeenCalledWith({ data: [], meta: {} });
  });

  it('llama next(err) si el servicio lanza', async () => {
    adminService.listarUsuarios.mockRejectedValue(new Error('db'));
    await listarUsuarios({ query: {} }, res(), mockNext);
    expect(mockNext).toHaveBeenCalledWith(expect.any(Error));
  });
});

// ── crearUsuario() ────────────────────────────────────────────────────────

describe('admin.controller → crearUsuario()', () => {
  beforeEach(() => vi.clearAllMocks());

  it('retorna 422 si faltan campos obligatorios (Zod)', async () => {
    const r = res();
    await crearUsuario({ body: { nombre: 'Juan' }, user: ADMIN }, r, mockNext);
    // Zod lanza ZodError → errorHandler devuelve 422 (no 400)
    expect(mockNext).toHaveBeenCalledWith(expect.any(Error));
  });

  it('crea usuario y retorna 201 sin exponer _passwordTemporal', async () => {
    adminService.crearUsuario.mockResolvedValue({
      id: 'u1', nombre: 'Juan', email: 'j@j.co', _passwordTemporal: 'secret',
    });
    const r = res();
    await crearUsuario({
      body: { nombre: 'Juan', email: 'j@j.co', rol: 'investigador' },
      user: ADMIN,
    }, r, mockNext);
    expect(r.status).toHaveBeenCalledWith(201);
    expect(r.json.mock.calls[0][0]).not.toHaveProperty('_passwordTemporal');
  });

  it('llama next(err) si el servicio lanza', async () => {
    adminService.crearUsuario.mockRejectedValue(new Error('dup'));
    await crearUsuario({
      body: { nombre: 'X', email: 'x@x.co', rol: 'investigador' },
      user: ADMIN,
    }, res(), mockNext);
    expect(mockNext).toHaveBeenCalledWith(expect.any(Error));
  });

  it('pasa el rol del caller (adminRol) al servicio — necesario para el guard anti-escalación', async () => {
    adminService.crearUsuario.mockResolvedValue({ id: 'u1', nombre: 'Juan', email: 'j@j.co' });
    await crearUsuario({
      body: { nombre: 'Juan', email: 'j@j.co', rol: 'investigador' },
      user: ADMIN,
    }, res(), mockNext);
    expect(adminService.crearUsuario).toHaveBeenCalledWith(
      expect.objectContaining({ adminRol: ADMIN.rol })
    );
  });
});

// ── actualizarUsuario() ───────────────────────────────────────────────────

describe('admin.controller → actualizarUsuario()', () => {
  beforeEach(() => vi.clearAllMocks());

  it('actualiza y retorna el usuario', async () => {
    adminService.actualizarUsuario.mockResolvedValue({ id: 'u1', rol: 'admin_sig' });
    const r = res();
    await actualizarUsuario({ params: { id: 'u1' }, body: { rol: 'admin_sig' }, user: ADMIN }, r, mockNext);
    expect(r.json).toHaveBeenCalledWith(expect.objectContaining({ rol: 'admin_sig' }));
  });

  it('llama next(err) si el servicio lanza', async () => {
    adminService.actualizarUsuario.mockRejectedValue(new Error('db'));
    await actualizarUsuario({ params: { id: 'u1' }, body: {}, user: ADMIN }, res(), mockNext);
    expect(mockNext).toHaveBeenCalledWith(expect.any(Error));
  });
});

// ── eliminarUsuario() ─────────────────────────────────────────────────────

describe('admin.controller → eliminarUsuario()', () => {
  beforeEach(() => vi.clearAllMocks());

  it('elimina el usuario y responde 204', async () => {
    adminService.eliminarUsuario.mockResolvedValue(undefined);
    const r = res();
    await eliminarUsuario({ params: { id: 'u1' }, user: ADMIN }, r, mockNext);
    expect(r.status).toHaveBeenCalledWith(204);
    expect(r.end).toHaveBeenCalled();
  });

  it('llama next(err) si el servicio lanza', async () => {
    adminService.eliminarUsuario.mockRejectedValue(new Error('db'));
    await eliminarUsuario({ params: { id: 'u1' }, user: ADMIN }, res(), mockNext);
    expect(mockNext).toHaveBeenCalledWith(expect.any(Error));
  });
});

// ── auditLog() ────────────────────────────────────────────────────────────

describe('admin.controller → auditLog()', () => {
  beforeEach(() => vi.clearAllMocks());

  it('retorna el log de auditoría', async () => {
    adminService.getAuditLog.mockResolvedValue({ data: [{ id: 1 }], meta: {} });
    const r = res();
    await auditLog({ query: {} }, r, mockNext);
    expect(r.json).toHaveBeenCalledWith(expect.objectContaining({ data: expect.any(Array) }));
  });

  it('llama next(err) si el servicio lanza', async () => {
    adminService.getAuditLog.mockRejectedValue(new Error('db'));
    await auditLog({ query: {} }, res(), mockNext);
    expect(mockNext).toHaveBeenCalledWith(expect.any(Error));
  });
});

// ── superStats() ──────────────────────────────────────────────────────────

describe('admin.controller → superStats()', () => {
  beforeEach(() => vi.clearAllMocks());

  it('retorna super estadísticas', async () => {
    adminService.getSuperStats.mockResolvedValue({ total: 100 });
    const r = res();
    await superStats({}, r, mockNext);
    expect(r.json).toHaveBeenCalledWith({ total: 100 });
  });

  it('llama next(err) si el servicio lanza', async () => {
    adminService.getSuperStats.mockRejectedValue(new Error('db'));
    await superStats({}, res(), mockNext);
    expect(mockNext).toHaveBeenCalledWith(expect.any(Error));
  });
});

// ── crearAdmin() ──────────────────────────────────────────────────────────

describe('admin.controller → crearAdmin()', () => {
  beforeEach(() => vi.clearAllMocks());

  it('retorna 422 si faltan nombre o email (Zod)', async () => {
    const r = res();
    await crearAdmin({ body: { nombre: 'Juan' }, user: ADMIN }, r, mockNext);
    // Zod lanza ZodError → errorHandler devuelve 422 (no 400)
    expect(mockNext).toHaveBeenCalledWith(expect.any(Error));
  });

  it('crea admin y retorna 201 sin exponer _passwordTemporal', async () => {
    adminService.crearAdminSig.mockResolvedValue({
      id: 'a1', nombre: 'Admin', email: 'a@a.co', _passwordTemporal: 'secret',
    });
    const r = res();
    await crearAdmin({ body: { nombre: 'Admin', email: 'a@a.co' }, user: ADMIN }, r, mockNext);
    expect(r.status).toHaveBeenCalledWith(201);
    expect(r.json.mock.calls[0][0]).not.toHaveProperty('_passwordTemporal');
  });

  it('llama next(err) si el servicio lanza', async () => {
    adminService.crearAdminSig.mockRejectedValue(new Error('db'));
    await crearAdmin({ body: { nombre: 'X', email: 'x@x.co' }, user: ADMIN }, res(), mockNext);
    expect(mockNext).toHaveBeenCalledWith(expect.any(Error));
  });
});

// ── custodiaRecurso() ─────────────────────────────────────────────────────

describe('admin.controller → custodiaRecurso()', () => {
  beforeEach(() => vi.clearAllMocks());

  it('retorna 400 si faltan tipo o id', async () => {
    const r = res();
    await custodiaRecurso({ query: { tipo: 'mapa' } }, r, mockNext);
    expect(r.status).toHaveBeenCalledWith(400);
  });

  it('retorna 400 si tipo no es mapa|documento', async () => {
    const r = res();
    await custodiaRecurso({ query: { tipo: 'otro', id: 'uuid-x' } }, r, mockNext);
    expect(r.status).toHaveBeenCalledWith(400);
  });

  it('llama next(err) si getCadenaCustodia lanza', async () => {
    getCadenaCustodia.mockRejectedValueOnce(new Error('db'));
    await custodiaRecurso({ query: { tipo: 'mapa', id: 'uuid-x' } }, res(), mockNext);
    expect(mockNext).toHaveBeenCalledWith(expect.any(Error));
  });
});

// ── descargasRecurso() ────────────────────────────────────────────────────

describe('admin.controller → descargasRecurso()', () => {
  beforeEach(() => vi.clearAllMocks());

  it('retorna 400 si faltan tipo o id', async () => {
    const r = res();
    await descargasRecurso({ query: {} }, r, mockNext);
    expect(r.status).toHaveBeenCalledWith(400);
  });

  it('retorna 400 si tipo es inválido', async () => {
    const r = res();
    await descargasRecurso({ query: { tipo: 'otro', id: 'x' } }, r, mockNext);
    expect(r.status).toHaveBeenCalledWith(400);
  });

  it('llama next(err) si getDescargasRecurso lanza', async () => {
    getDescargasRecurso.mockRejectedValueOnce(new Error('db'));
    await descargasRecurso({ query: { tipo: 'documento', id: 'uuid-x' } }, res(), mockNext);
    expect(mockNext).toHaveBeenCalledWith(expect.any(Error));
  });
});

// ── descargasStats() ──────────────────────────────────────────────────────

describe('admin.controller → descargasStats()', () => {
  beforeEach(() => vi.clearAllMocks());

  it('retorna estadísticas de descargas', async () => {
    query.mockResolvedValueOnce({ rows: [{ tipo_recurso: 'mapa', total_descargas: 5, recurso_id: 'u1', recurso_titulo: 'Mapa', usuarios_unicos: 3, ultima_descarga: new Date() }] });
    const r = res();
    await descargasStats({}, r, mockNext);
    expect(r.json).toHaveBeenCalledWith({ data: expect.any(Array) });
  });

  it('llama next(err) si query lanza', async () => {
    query.mockRejectedValueOnce(new Error('db'));
    await descargasStats({}, res(), mockNext);
    expect(mockNext).toHaveBeenCalledWith(expect.any(Error));
  });
});

// ─── Success paths for custodiaRecurso and descargasRecurso ───────────────

describe('admin.controller → custodiaRecurso() — success', () => {
  beforeEach(() => vi.clearAllMocks());

  it('retorna custodia de mapa', async () => {
    getCadenaCustodia.mockResolvedValueOnce([{ accion: 'ingreso' }]);
    const r = res();
    await custodiaRecurso({ query: { tipo: 'mapa', id: 'uuid-m1' } }, r, mockNext);
    expect(r.json).toHaveBeenCalledWith({ data: [{ accion: 'ingreso' }] });
  });

  it('retorna custodia de documento', async () => {
    getCadenaCustodia.mockResolvedValueOnce([]);
    const r = res();
    await custodiaRecurso({ query: { tipo: 'documento', id: 'uuid-d1' } }, r, mockNext);
    expect(r.json).toHaveBeenCalledWith({ data: [] });
  });
});

describe('admin.controller → descargasRecurso() — success', () => {
  beforeEach(() => vi.clearAllMocks());

  it('retorna descargas de mapa', async () => {
    getDescargasRecurso.mockResolvedValueOnce([{ usuario_email: 'a@a.co' }]);
    const r = res();
    await descargasRecurso({ query: { tipo: 'mapa', id: 'uuid-m1' } }, r, mockNext);
    expect(r.json).toHaveBeenCalledWith({ data: [{ usuario_email: 'a@a.co' }] });
  });

  it('retorna descargas de documento', async () => {
    getDescargasRecurso.mockResolvedValueOnce([]);
    const r = res();
    await descargasRecurso({ query: { tipo: 'documento', id: 'uuid-d1' } }, r, mockNext);
    expect(r.json).toHaveBeenCalledWith({ data: [] });
  });
});

// ── scanLog() ────────────────────────────────────────────────────────────

describe('admin.controller → scanLog()', () => {
  beforeEach(() => vi.clearAllMocks());

  it('retorna el log de escaneo sin filtros', async () => {
    query.mockResolvedValueOnce({ rows: [{ id: 1, resultado: 'clean' }] });
    const r = res();
    await scanLog({ query: {} }, r, mockNext);
    expect(r.json).toHaveBeenCalledWith({ data: [{ id: 1, resultado: 'clean' }] });
    const [sql, params] = query.mock.calls[0];
    expect(sql).not.toContain('WHERE');
    expect(params).toEqual([50]);
  });

  it('filtra por resultado cuando es un valor permitido', async () => {
    query.mockResolvedValueOnce({ rows: [] });
    const r = res();
    await scanLog({ query: { resultado: 'rejected' } }, r, mockNext);
    const [sql, params] = query.mock.calls[0];
    expect(sql).toContain('WHERE resultado = $1');
    expect(params).toEqual(['rejected', 50]);
  });

  it('ignora resultado con valor no permitido', async () => {
    query.mockResolvedValueOnce({ rows: [] });
    const r = res();
    await scanLog({ query: { resultado: 'malware' } }, r, mockNext);
    const [sql, params] = query.mock.calls[0];
    expect(sql).not.toContain('WHERE');
    expect(params).toEqual([50]);
  });

  it('limita el limit a un máximo de 200', async () => {
    query.mockResolvedValueOnce({ rows: [] });
    const r = res();
    await scanLog({ query: { limit: '9999' } }, r, mockNext);
    const [, params] = query.mock.calls[0];
    expect(params).toEqual([200]);
  });

  it('usa 50 como límite por defecto si limit no es numérico', async () => {
    query.mockResolvedValueOnce({ rows: [] });
    const r = res();
    await scanLog({ query: { limit: 'abc' } }, r, mockNext);
    const [, params] = query.mock.calls[0];
    expect(params).toEqual([50]);
  });

  it('llama next(err) si query lanza', async () => {
    query.mockRejectedValueOnce(new Error('db'));
    await scanLog({ query: {} }, res(), mockNext);
    expect(mockNext).toHaveBeenCalledWith(expect.any(Error));
  });
});

// ── batchUsuarios() ──────────────────────────────────────────────────────

describe('admin.controller → batchUsuarios()', () => {
  beforeEach(() => vi.clearAllMocks());

  it('retorna 400 si ids no es un array', async () => {
    const r = res();
    await batchUsuarios({ body: { ids: 'no-array', accion: 'activar' }, user: ADMIN }, r, mockNext);
    expect(r.status).toHaveBeenCalledWith(400);
  });

  it('retorna 400 si ids es un array vacío', async () => {
    const r = res();
    await batchUsuarios({ body: { ids: [], accion: 'activar' }, user: ADMIN }, r, mockNext);
    expect(r.status).toHaveBeenCalledWith(400);
  });

  it('retorna 400 si ids supera los 50 elementos', async () => {
    const r = res();
    const ids = Array.from({ length: 51 }, () => TARGET_1);
    await batchUsuarios({ body: { ids, accion: 'activar' }, user: ADMIN }, r, mockNext);
    expect(r.status).toHaveBeenCalledWith(400);
    expect(r.json.mock.calls[0][0].error).toMatch(/Máximo 50/);
  });

  it('retorna 400 si algún id no es un UUID válido', async () => {
    const r = res();
    await batchUsuarios({ body: { ids: ['no-uuid'], accion: 'activar' }, user: ADMIN }, r, mockNext);
    expect(r.status).toHaveBeenCalledWith(400);
    expect(r.json.mock.calls[0][0].error).toMatch(/UUIDs válidos/);
  });

  it('retorna 400 si accion no es válida', async () => {
    const r = res();
    await batchUsuarios({ body: { ids: [TARGET_1], accion: 'volar' }, user: ADMIN }, r, mockNext);
    expect(r.status).toHaveBeenCalledWith(400);
    expect(r.json.mock.calls[0][0].error).toMatch(/accion debe ser/);
  });

  it('retorna 400 si accion es cambiar-rol con rol inválido', async () => {
    const r = res();
    await batchUsuarios({
      body: { ids: [TARGET_1], accion: 'cambiar-rol', rol: 'super_admin' }, user: ADMIN,
    }, r, mockNext);
    expect(r.status).toHaveBeenCalledWith(400);
    expect(r.json.mock.calls[0][0].error).toMatch(/rol inválido/);
  });

  it('retorna 403 si admin_sig intenta asignar rol admin_sig', async () => {
    const r = res();
    await batchUsuarios({
      body: { ids: [TARGET_1], accion: 'cambiar-rol', rol: 'admin_sig' }, user: ADMIN,
    }, r, mockNext);
    expect(r.status).toHaveBeenCalledWith(403);
    expect(r.json.mock.calls[0][0].error).toMatch(/super_admin puede asignar/);
  });

  it('permite a super_admin asignar rol admin_sig', async () => {
    query
      .mockResolvedValueOnce({ rows: [{ id: TARGET_1, rol: 'investigador' }] })
      .mockResolvedValueOnce({ rowCount: 1 })
      .mockResolvedValueOnce({ rows: [{ email: 't1@iiap.org.co', nombre: 'T1', rol: 'admin_sig', activo: true }] });
    const r = res();
    await batchUsuarios({
      body: { ids: [TARGET_1], accion: 'cambiar-rol', rol: 'admin_sig' }, user: SUPERADMIN,
    }, r, mockNext);
    expect(r.status).not.toHaveBeenCalledWith(403);
    expect(r.json).toHaveBeenCalledWith(expect.objectContaining({ afectados: 1 }));
  });

  it('retorna 400 si un usuario intenta operar sobre su propia cuenta', async () => {
    const selfAdmin = { ...ADMIN, id: TARGET_1 };
    const r = res();
    await batchUsuarios({
      body: { ids: [TARGET_1], accion: 'activar' }, user: selfAdmin,
    }, r, mockNext);
    expect(r.status).toHaveBeenCalledWith(400);
    expect(r.json.mock.calls[0][0].error).toMatch(/propia cuenta/);
  });

  it('retorna 403 si algún target es super_admin', async () => {
    query.mockResolvedValueOnce({ rows: [{ id: SUPER_TARGET, rol: 'super_admin' }] });
    const r = res();
    await batchUsuarios({ body: { ids: [SUPER_TARGET], accion: 'activar' }, user: ADMIN }, r, mockNext);
    expect(r.status).toHaveBeenCalledWith(403);
    expect(r.json.mock.calls[0][0].error).toMatch(/super_admin en batch/);
  });

  it('retorna 403 si admin_sig intenta desactivar a otro admin_sig', async () => {
    query.mockResolvedValueOnce({ rows: [{ id: TARGET_1, rol: 'admin_sig' }] });
    const r = res();
    await batchUsuarios({ body: { ids: [TARGET_1], accion: 'desactivar' }, user: ADMIN }, r, mockNext);
    expect(r.status).toHaveBeenCalledWith(403);
    expect(r.json.mock.calls[0][0].error).toMatch(/otros admin_sig/);
  });

  it('permite a super_admin desactivar a un admin_sig', async () => {
    query
      .mockResolvedValueOnce({ rows: [{ id: TARGET_1, rol: 'admin_sig' }] })
      .mockResolvedValueOnce({ rowCount: 1 })
      .mockResolvedValueOnce({ rows: [{ email: 't1@iiap.org.co', nombre: 'T1', rol: 'admin_sig', activo: false }] });
    const r = res();
    await batchUsuarios({ body: { ids: [TARGET_1], accion: 'desactivar' }, user: SUPERADMIN }, r, mockNext);
    expect(r.status).not.toHaveBeenCalledWith(403);
    expect(r.json).toHaveBeenCalledWith(expect.objectContaining({ afectados: 1 }));
  });

  it('activa usuarios en lote, notifica y registra auditoría', async () => {
    query
      .mockResolvedValueOnce({ rows: [{ id: TARGET_1, rol: 'investigador' }, { id: TARGET_2, rol: 'tecnico' }] })
      .mockResolvedValueOnce({ rowCount: 2 })
      .mockResolvedValueOnce({ rows: [
        { email: 't1@iiap.org.co', nombre: 'T1', rol: 'investigador', activo: true },
        { email: 't2@iiap.org.co', nombre: 'T2', rol: 'tecnico', activo: true },
      ] });
    const r = res();
    await batchUsuarios({
      body: { ids: [TARGET_1, TARGET_2], accion: 'activar' }, user: ADMIN,
    }, r, mockNext);

    expect(r.json).toHaveBeenCalledWith({ message: '2 usuarios actualizados', afectados: 2 });
    expect(notifyUsuarioActivacion).toHaveBeenCalledTimes(2);
    expect(revokeAllRefreshTokens).not.toHaveBeenCalled();
    expect(registrarAuditoria).toHaveBeenCalledWith(expect.objectContaining({ accion: 'batch_activar' }));
  });

  it('desactiva usuarios en lote y notifica', async () => {
    query
      .mockResolvedValueOnce({ rows: [{ id: TARGET_1, rol: 'investigador' }] })
      .mockResolvedValueOnce({ rowCount: 1 })
      .mockResolvedValueOnce({ rows: [{ email: 't1@iiap.org.co', nombre: 'T1', rol: 'investigador', activo: false }] });
    const r = res();
    await batchUsuarios({ body: { ids: [TARGET_1], accion: 'desactivar' }, user: ADMIN }, r, mockNext);

    expect(r.json).toHaveBeenCalledWith({ message: '1 usuarios actualizados', afectados: 1 });
    expect(notifyUsuarioActivacion).toHaveBeenCalledOnce();
  });

  it('cambia el rol en lote, revoca refresh tokens y notifica', async () => {
    query
      .mockResolvedValueOnce({ rows: [{ id: TARGET_1, rol: 'investigador' }] })
      .mockResolvedValueOnce({ rowCount: 1 })
      .mockResolvedValueOnce({ rows: [{ email: 't1@iiap.org.co', nombre: 'T1', rol: 'investigador', activo: true }] });
    const r = res();
    await batchUsuarios({
      body: { ids: [TARGET_1], accion: 'cambiar-rol', rol: 'tecnico' }, user: ADMIN,
    }, r, mockNext);

    expect(r.json).toHaveBeenCalledWith({ message: '1 usuarios actualizados', afectados: 1 });
    expect(revokeAllRefreshTokens).toHaveBeenCalledWith(TARGET_1);
    expect(notifyRolCambiado).toHaveBeenCalledOnce();
  });

  it('llama next(err) si query de targets lanza', async () => {
    query.mockRejectedValueOnce(new Error('db'));
    await batchUsuarios({ body: { ids: [TARGET_1], accion: 'activar' }, user: ADMIN }, res(), mockNext);
    expect(mockNext).toHaveBeenCalledWith(expect.any(Error));
  });
});
