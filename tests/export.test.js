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
  };
}
const mockNext = vi.fn();

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

  it('retorna CSV del audit log', async () => {
    query.mockResolvedValueOnce({ rows: [AUDIT_ROW] });
    const req = { query: {}, user: ADMIN_USER, ip: '10.0.0.1' };
    const res = mockRes();
    await exportAudit(req, res, mockNext);
    expect(res.setHeader).toHaveBeenCalledWith('Content-Type', expect.stringContaining('text/csv'));
    expect(registrarAuditoria).toHaveBeenCalledWith(expect.objectContaining({ accion: 'export_audit' }));
  });

  it('aplica filtros de fecha desde/hasta', async () => {
    query.mockResolvedValueOnce({ rows: [AUDIT_ROW] });
    const req = { query: { desde: '2025-01-01', hasta: '2025-06-30' }, user: ADMIN_USER, ip: '10.0.0.1' };
    const res = mockRes();
    await exportAudit(req, res, mockNext);
    const [sql] = query.mock.calls[0];
    expect(sql).toMatch(/creado_en >= \$1/);
  });

  it('retorna 400 si hay 10.000 o más registros', async () => {
    query.mockResolvedValueOnce({ rows: Array.from({ length: 10_000 }, () => ({ ...AUDIT_ROW })) });
    const req = { query: {}, user: ADMIN_USER, ip: '10.0.0.1' };
    const res = mockRes();
    await exportAudit(req, res, mockNext);
    expect(res.status).toHaveBeenCalledWith(400);
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

  const DL_ROW = { id: 'd1', archivo_key: 'mapas/file.pdf', usuario_id: 'u1', ip_origen: '10.0.0.1', descargado_en: new Date() };

  it('retorna CSV de descargas', async () => {
    query.mockResolvedValueOnce({ rows: [DL_ROW] });
    const req = { query: {}, user: ADMIN_USER, ip: '10.0.0.1' };
    const res = mockRes();
    await exportDescargas(req, res, mockNext);
    expect(res.setHeader).toHaveBeenCalledWith('Content-Type', expect.stringContaining('text/csv'));
    expect(registrarAuditoria).toHaveBeenCalledWith(expect.objectContaining({ accion: 'export_descargas' }));
  });

  it('retorna JSON de descargas cuando formato=json', async () => {
    query.mockResolvedValueOnce({ rows: [DL_ROW] });
    const req = { query: { formato: 'json' }, user: ADMIN_USER, ip: '10.0.0.1' };
    const res = mockRes();
    await exportDescargas(req, res, mockNext);
    expect(res.json).toHaveBeenCalledOnce();
  });

  it('llama next(err) ante error de DB', async () => {
    query.mockRejectedValueOnce(new Error('fail'));
    const req = { query: {}, user: ADMIN_USER, ip: '10.0.0.1' };
    const res = mockRes();
    await exportDescargas(req, res, mockNext);
    expect(mockNext).toHaveBeenCalledWith(expect.any(Error));
  });
});
