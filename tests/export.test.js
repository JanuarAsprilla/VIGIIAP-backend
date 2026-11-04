import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../src/config/database.js', () => ({
  query: vi.fn().mockResolvedValue({ rows: [] }),
  getClient: vi.fn(),
}));

vi.mock('../src/utils/auditLog.js', () => ({
  registrarAuditoria: vi.fn(),
}));

vi.mock('../src/utils/logger.js', () => ({
  default: { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() },
}));

import { query } from '../src/config/database.js';
import { registrarAuditoria } from '../src/utils/auditLog.js';
import {
  exportUsuarios,
  exportSolicitudes,
  exportAudit,
  exportDescargas,
} from '../src/modules/admin/export.controller.js';

const ADMIN_USER = { id: 'admin-uuid', email: 'admin@iiap.org.co', rol: 'admin_sig' };

function mockRes() {
  return {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
    send: vi.fn().mockReturnThis(),
    setHeader: vi.fn().mockReturnThis(),
    write: vi.fn().mockReturnValue(true),
    end: vi.fn().mockReturnThis(),
    once: vi.fn().mockReturnThis(),
    off: vi.fn().mockReturnThis(),
    destroy: vi.fn().mockReturnThis(),
  };
}
const mockNext = vi.fn();

/** El CSV de actividad y de descargas se transmite: primero cuenta y después lee un bloque. */
function mockCsv(rows) {
  query.mockResolvedValueOnce({ rows: [{ total: rows.length }] }).mockResolvedValueOnce({ rows });
}

// ─── exportUsuarios() ─────────────────────────────────────────────────────────

describe('exportUsuarios()', () => {
  beforeEach(() => vi.clearAllMocks());

  it('retorna CSV por defecto', async () => {
    query.mockResolvedValueOnce({ rows: [
      { id: 'u1', nombre: 'Test', email: 'test@iiap.org.co', rol: 'investigador',
        tipo_acceso: 'interno', institucion: 'IIAP', activo: true,
        email_verified: true, last_login_at: null, creado_en: new Date() }
    ]});

    const req = { query: {}, user: ADMIN_USER, ip: '10.0.0.1' };
    const res = mockRes();
    await exportUsuarios(req, res, mockNext);

    expect(res.setHeader).toHaveBeenCalledWith('Content-Type', expect.stringContaining('text/csv'));
    expect(res.send).toHaveBeenCalledOnce();
    expect(registrarAuditoria).toHaveBeenCalledWith(
      expect.objectContaining({ accion: 'export_usuarios' })
    );
  });

  it('retorna JSON cuando formato=json', async () => {
    query.mockResolvedValueOnce({ rows: [
      { id: 'u1', nombre: 'Test', email: 'test@iiap.org.co', rol: 'investigador',
        tipo_acceso: 'interno', institucion: 'IIAP', activo: true,
        email_verified: true, last_login_at: null, creado_en: new Date() }
    ]});

    const req = { query: { formato: 'json' }, user: ADMIN_USER, ip: '10.0.0.1' };
    const res = mockRes();
    await exportUsuarios(req, res, mockNext);

    expect(res.setHeader).toHaveBeenCalledWith('Content-Disposition', expect.stringContaining('.json'));
    expect(res.json).toHaveBeenCalledOnce();
  });

  it('retorna 400 si hay 10.000 o más registros (límite alcanzado)', async () => {
    // Simular exactamente 10.000 filas
    const rows = Array.from({ length: 10_000 }, (_, i) => ({ id: `u${i}`, nombre: 'Test', email: 'x@y.co', rol: 'investigador', tipo_acceso: 'interno', institucion: 'IIAP', activo: true, email_verified: true, last_login_at: null, creado_en: new Date() }));
    query.mockResolvedValueOnce({ rows });

    const req = { query: {}, user: ADMIN_USER, ip: '10.0.0.1' };
    const res = mockRes();
    await exportUsuarios(req, res, mockNext);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ error: expect.any(String) }));
  });

  it('omite campos sensibles en la salida JSON', async () => {
    query.mockResolvedValueOnce({ rows: [
      { id: 'u1', nombre: 'Test', email: 'test@iiap.org.co', rol: 'investigador',
        tipo_acceso: 'interno', institucion: 'IIAP', activo: true,
        email_verified: true, last_login_at: null, creado_en: new Date(),
        password_hash: 'SHOULD_BE_REMOVED', totp_secret: 'ALSO_REMOVED' }
    ]});

    const req = { query: { formato: 'json' }, user: ADMIN_USER, ip: '10.0.0.1' };
    const res = mockRes();
    await exportUsuarios(req, res, mockNext);

    const exportedData = res.json.mock.calls[0][0];
    expect(exportedData[0]).not.toHaveProperty('password_hash');
    expect(exportedData[0]).not.toHaveProperty('totp_secret');
  });

  it('llama next(err) ante error de DB', async () => {
    query.mockRejectedValueOnce(new Error('DB fail'));
    const req = { query: {}, user: ADMIN_USER, ip: '10.0.0.1' };
    const res = mockRes();
    await exportUsuarios(req, res, mockNext);
    expect(mockNext).toHaveBeenCalledWith(expect.any(Error));
  });
});

// ─── exportSolicitudes() ──────────────────────────────────────────────────────

describe('exportSolicitudes()', () => {
  beforeEach(() => vi.clearAllMocks());

  const SOL_ROW = { id: 's1', tipo: 'acceso', descripcion: 'Test', estado: 'pendiente', nota_admin: null, creado_en: new Date(), actualizado_en: new Date() };

  it('retorna CSV sin filtros de fecha', async () => {
    query.mockResolvedValueOnce({ rows: [SOL_ROW] });

    const req = { query: {}, user: ADMIN_USER, ip: '10.0.0.1' };
    const res = mockRes();
    await exportSolicitudes(req, res, mockNext);

    expect(res.setHeader).toHaveBeenCalledWith('Content-Type', expect.stringContaining('text/csv'));
    expect(res.send).toHaveBeenCalledOnce();
  });

  it('aplica filtro de fecha desde/hasta', async () => {
    query.mockResolvedValueOnce({ rows: [SOL_ROW] });

    const req = { query: { desde: '2025-01-01', hasta: '2025-12-31' }, user: ADMIN_USER, ip: '10.0.0.1' };
    const res = mockRes();
    await exportSolicitudes(req, res, mockNext);

    const [sql] = query.mock.calls[0];
    expect(sql).toMatch(/creado_en >= \$1/);
    expect(sql).toMatch(/creado_en <= \$2/);
  });

  it('retorna JSON cuando formato=json', async () => {
    query.mockResolvedValueOnce({ rows: [SOL_ROW] });

    const req = { query: { formato: 'json' }, user: ADMIN_USER, ip: '10.0.0.1' };
    const res = mockRes();
    await exportSolicitudes(req, res, mockNext);

    expect(res.json).toHaveBeenCalledOnce();
  });

  it('retorna 400 si hay 10.000 o más registros', async () => {
    const rows = Array.from({ length: 10_000 }, () => ({ ...SOL_ROW }));
    query.mockResolvedValueOnce({ rows });

    const req = { query: {}, user: ADMIN_USER, ip: '10.0.0.1' };
    const res = mockRes();
    await exportSolicitudes(req, res, mockNext);

    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('llama next(err) con 422 si "desde" no es una fecha ISO válida', async () => {
    const req = { query: { desde: 'no-es-fecha' }, user: ADMIN_USER, ip: '10.0.0.1' };
    const res = mockRes();
    await exportSolicitudes(req, res, mockNext);
    expect(mockNext).toHaveBeenCalledWith(expect.objectContaining({ status: 422 }));
    expect(query).not.toHaveBeenCalled();
  });

  it('llama next(err) con 422 si "hasta" no es una fecha ISO válida', async () => {
    const req = { query: { hasta: '31-12-2025' }, user: ADMIN_USER, ip: '10.0.0.1' };
    const res = mockRes();
    await exportSolicitudes(req, res, mockNext);
    expect(mockNext).toHaveBeenCalledWith(expect.objectContaining({ status: 422 }));
  });

  it('llama next(err) ante error de DB', async () => {
    query.mockRejectedValueOnce(new Error('DB fail'));
    const req = { query: {}, user: ADMIN_USER, ip: '10.0.0.1' };
    const res = mockRes();
    await exportSolicitudes(req, res, mockNext);
    expect(mockNext).toHaveBeenCalledWith(expect.any(Error));
  });
});

// ─── exportAudit() ────────────────────────────────────────────────────────────

describe('exportAudit()', () => {
  beforeEach(() => vi.clearAllMocks());

  const AUDIT_ROW = { id: 'a1', accion: 'login', modulo: 'auth', entidad_id: null, descripcion: 'Test', usuario_email: 'x@y.co', ip: '10.0.0.1', creado_en: new Date() };

  it('retorna CSV del audit log, transmitido: cuenta primero y luego lee un bloque', async () => {
    mockCsv([AUDIT_ROW]);
    const req = { query: {}, user: ADMIN_USER, ip: '10.0.0.1' };
    const res = mockRes();
    await exportAudit(req, res, mockNext);
    expect(res.setHeader).toHaveBeenCalledWith('Content-Type', expect.stringContaining('text/csv'));
    expect(res.setHeader).toHaveBeenCalledWith('Content-Disposition', 'attachment; filename="audit-log.csv"');
    expect(res.write).toHaveBeenCalled();
    expect(res.end).toHaveBeenCalledOnce();
    expect(query.mock.calls[0][0]).toMatch(/SELECT COUNT\(\*\)/);
    expect(registrarAuditoria).toHaveBeenCalledWith(expect.objectContaining({ accion: 'export_audit', descripcion: expect.stringContaining('1 registros, csv') }));
  });

  it('el CSV no tiene el tope de 10 000: se rechaza solo por encima del tope de transmisión', async () => {
    query.mockResolvedValueOnce({ rows: [{ total: 250_000 }] }).mockResolvedValueOnce({ rows: [AUDIT_ROW] });
    const res = mockRes();
    await exportAudit({ query: {}, user: ADMIN_USER, ip: '10.0.0.1' }, res, mockNext);
    expect(res.status).not.toHaveBeenCalledWith(400);
    expect(res.write).toHaveBeenCalled();
  });

  it('el CSV responde 400 sin enviar nada si supera el tope de transmisión', async () => {
    query.mockResolvedValueOnce({ rows: [{ total: 500_001 }] });
    const res = mockRes();
    await exportAudit({ query: {}, user: ADMIN_USER, ip: '10.0.0.1' }, res, mockNext);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.write).not.toHaveBeenCalled();
    expect(registrarAuditoria).not.toHaveBeenCalled();
  });

  it('aplica filtros de fecha desde/hasta', async () => {
    mockCsv([AUDIT_ROW]);
    const req = { query: { desde: '2025-01-01', hasta: '2025-06-30' }, user: ADMIN_USER, ip: '10.0.0.1' };
    const res = mockRes();
    await exportAudit(req, res, mockNext);
    const [sql] = query.mock.calls[0];
    expect(sql).toMatch(/creado_en >= \$1/);
  });

  it('aplica los filtros de usuario, IP, resultado, módulo y gravedad', async () => {
    mockCsv([AUDIT_ROW]);
    const req = {
      query: { usuario: 'x@', ip: '10.0', resultado: 'denegado', modulo: 'auth', severidad: 'critica' },
      user: ADMIN_USER, ip: '10.0.0.1',
    };
    await exportAudit(req, mockRes(), mockNext);
    const [sql, params] = query.mock.calls[0];
    expect(sql).toMatch(/usuario_email ILIKE/);
    expect(sql).toMatch(/ip LIKE/);
    expect(sql).toMatch(/resultado = /);
    expect(sql).toMatch(/modulo = /);
    expect(params).toEqual(expect.arrayContaining(['%x@%', '10.0%', 'denegado', 'auth']));
  });

  it('ignora resultado y gravedad desconocidos y una IP con caracteres inválidos', async () => {
    mockCsv([AUDIT_ROW]);
    const req = { query: { resultado: 'raro', severidad: 'x', ip: "1' OR 1=1" }, user: { ...ADMIN_USER, rol: 'super_admin' }, ip: '10.0.0.1' };
    await exportAudit(req, mockRes(), mockNext);
    const [sql, params] = query.mock.calls[0];
    expect(sql).not.toMatch(/resultado = |ip LIKE/);
    expect(params).toEqual([]);
  });

  it('excluye actividad de super_admin cuando quien exporta es admin_sig', async () => {
    mockCsv([AUDIT_ROW]);
    const req = { query: {}, user: ADMIN_USER, ip: '10.0.0.1' };
    const res = mockRes();
    await exportAudit(req, res, mockNext);
    const [sql] = query.mock.calls[0];
    expect(sql).toMatch(/super_admin/);
  });

  it('NO excluye actividad de super_admin cuando quien exporta es otro super_admin', async () => {
    mockCsv([AUDIT_ROW]);
    const req = { query: {}, user: { ...ADMIN_USER, rol: 'super_admin' }, ip: '10.0.0.1' };
    const res = mockRes();
    await exportAudit(req, res, mockNext);
    const [sql] = query.mock.calls[0];
    expect(sql).not.toMatch(/super_admin/);
  });

  it('en JSON retorna 400 si hay 10.000 o más registros, y orienta hacia el CSV', async () => {
    query.mockResolvedValueOnce({ rows: Array.from({ length: 10_000 }, () => ({ ...AUDIT_ROW })) });
    const req = { query: { formato: 'json' }, user: ADMIN_USER, ip: '10.0.0.1' };
    const res = mockRes();
    await exportAudit(req, res, mockNext);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ error: expect.stringContaining('CSV') });
  });

  it('llama next(err) ante error de DB', async () => {
    query.mockRejectedValueOnce(new Error('fail'));
    const req = { query: {}, user: ADMIN_USER, ip: '10.0.0.1' };
    const res = mockRes();
    await exportAudit(req, res, mockNext);
    expect(mockNext).toHaveBeenCalledWith(expect.any(Error));
  });
});

// ─── exportDescargas() ────────────────────────────────────────────────────────

describe('exportDescargas()', () => {
  beforeEach(() => vi.clearAllMocks());

  const DL_ROW = {
    id: 'd1', tipo_recurso: 'mapa', recurso_id: 'r1', recurso_titulo: 'Mapa del Atrato',
    usuario_id: 'u1', usuario_email: 'ana@iiap.org.co', ip: '10.0.0.1', created_at: new Date(),
  };

  it('retorna CSV de descargas, transmitido', async () => {
    mockCsv([DL_ROW]);
    const req = { query: {}, user: ADMIN_USER, ip: '10.0.0.1' };
    const res = mockRes();
    await exportDescargas(req, res, mockNext);
    expect(res.setHeader).toHaveBeenCalledWith('Content-Type', expect.stringContaining('text/csv'));
    expect(res.write).toHaveBeenCalled();
    expect(registrarAuditoria).toHaveBeenCalledWith(expect.objectContaining({ accion: 'export_descargas' }));
  });

  it('consulta las columnas reales de descarga_log y no expone la ubicación interna del archivo', async () => {
    mockCsv([DL_ROW]);
    await exportDescargas({ query: {}, user: ADMIN_USER, ip: '10.0.0.1' }, mockRes(), mockNext);
    const sqlLectura = query.mock.calls[1][0];
    expect(sqlLectura).toMatch(/recurso_titulo/);
    expect(sqlLectura).toMatch(/created_at/);
    expect(sqlLectura).not.toMatch(/archivo_key|ip_origen|descargado_en|archivo_url/);
  });

  it('retorna JSON de descargas cuando formato=json', async () => {
    query.mockResolvedValueOnce({ rows: [DL_ROW] });
    const req = { query: { formato: 'json' }, user: ADMIN_USER, ip: '10.0.0.1' };
    const res = mockRes();
    await exportDescargas(req, res, mockNext);
    expect(res.json).toHaveBeenCalledOnce();
  });

  it('en JSON retorna 400 si hay 10.000 o más registros', async () => {
    const rows = Array.from({ length: 10_000 }, () => ({ ...DL_ROW }));
    query.mockResolvedValueOnce({ rows });
    const req = { query: { formato: 'json' }, user: ADMIN_USER, ip: '10.0.0.1' };
    const res = mockRes();
    await exportDescargas(req, res, mockNext);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('llama next(err) ante error de DB', async () => {
    query.mockRejectedValueOnce(new Error('fail'));
    const req = { query: {}, user: ADMIN_USER, ip: '10.0.0.1' };
    const res = mockRes();
    await exportDescargas(req, res, mockNext);
    expect(mockNext).toHaveBeenCalledWith(expect.any(Error));
  });
});
