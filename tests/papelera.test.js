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
import { getPapelera, restaurar, purgar } from '../src/modules/admin/papelera.controller.js';

const ADMIN_USER = { id: 'admin-uuid', email: 'admin@iiap.org.co', rol: 'admin_sig' };

function mockRes() {
  return {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
  };
}
const mockNext = vi.fn();

// ─── getPapelera() ────────────────────────────────────────────────────────────

describe('getPapelera()', () => {
  beforeEach(() => vi.clearAllMocks());

  it('retorna 400 si tipo es inválido', async () => {
    const req = { query: { tipo: 'invalido' } };
    const res = mockRes();
    await getPapelera(req, res, mockNext);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ error: expect.any(String) }));
  });

  it('retorna 400 si tipo está ausente', async () => {
    const req = { query: {} };
    const res = mockRes();
    await getPapelera(req, res, mockNext);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('retorna datos de la papelera para tipo=mapa', async () => {
    const MAPA = { id: 'uuid-m1', titulo: 'Mapa Chocó', deleted_at: new Date() };
    query
      .mockResolvedValueOnce({ rows: [MAPA] })              // SELECT data
      .mockResolvedValueOnce({ rows: [{ count: '1' }] });   // COUNT

    const req = { query: { tipo: 'mapa' } };
    const res = mockRes();
    await getPapelera(req, res, mockNext);

    expect(query).toHaveBeenCalledTimes(2);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        data: [MAPA],
        meta: expect.objectContaining({ total: 1 }),
      })
    );
  });

  it('declara el alias de tabla en el FROM — regresión: COLS usa "m.id" pero FROM no declaraba el alias "m", causando 500 real en producción', async () => {
    query
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ count: '0' }] });

    const req = { query: { tipo: 'mapa' } };
    const res = mockRes();
    await getPapelera(req, res, mockNext);

    const [sql] = query.mock.calls[0];
    expect(sql).toMatch(/FROM mapas m\b/);
  });

  it('retorna datos para tipo=documento', async () => {
    query
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ count: '0' }] });

    const req = { query: { tipo: 'documento' } };
    const res = mockRes();
    await getPapelera(req, res, mockNext);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ data: [] }));
  });

  it('retorna 400 para tipo=noticia (módulo eliminado del proyecto)', async () => {
    const req = { query: { tipo: 'noticia' } };
    const res = mockRes();
    await getPapelera(req, res, mockNext);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('retorna datos para tipo=categoria', async () => {
    query
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ count: '0' }] });

    const req = { query: { tipo: 'categoria' } };
    const res = mockRes();
    await getPapelera(req, res, mockNext);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ data: [] }));
  });

  it('retorna datos para tipo=geovisor', async () => {
    const GEOVISOR = { id: 'uuid-g1', titulo: 'Geología del Chocó', deleted_at: new Date() };
    query
      .mockResolvedValueOnce({ rows: [GEOVISOR] })
      .mockResolvedValueOnce({ rows: [{ count: '1' }] });

    const req = { query: { tipo: 'geovisor' } };
    const res = mockRes();
    await getPapelera(req, res, mockNext);

    const [sql] = query.mock.calls[0];
    expect(sql).toMatch(/FROM geovisores g\b/);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ data: [GEOVISOR] })
    );
  });

  it('admite paginación con page y limit', async () => {
    query
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ count: '50' }] });

    const req = { query: { tipo: 'mapa', page: '2', limit: '10' } };
    const res = mockRes();
    await getPapelera(req, res, mockNext);

    const [sql, params] = query.mock.calls[0];
    expect(params[0]).toBe(10);  // limit
    expect(params[1]).toBe(10);  // offset (page=2, limit=10 → offset=10)
  });

  it('llama next(err) ante error de DB', async () => {
    query.mockRejectedValueOnce(new Error('DB fail'));
    const req = { query: { tipo: 'mapa' } };
    const res = mockRes();
    await getPapelera(req, res, mockNext);
    expect(mockNext).toHaveBeenCalledWith(expect.any(Error));
  });
});

// ─── restaurar() ─────────────────────────────────────────────────────────────

describe('restaurar()', () => {
  beforeEach(() => vi.clearAllMocks());

  it('retorna 400 si tipo es inválido', async () => {
    const req = { params: { tipo: 'invalido', id: 'uuid-1' }, user: ADMIN_USER, ip: '10.0.0.1' };
    const res = mockRes();
    await restaurar(req, res, mockNext);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('retorna 400 si id no es un UUID válido para tipo=mapa', async () => {
    const req = { params: { tipo: 'mapa', id: 'no-es-un-uuid' }, user: ADMIN_USER, ip: '10.0.0.1' };
    const res = mockRes();
    await restaurar(req, res, mockNext);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(query).not.toHaveBeenCalled();
  });

  it('retorna 400 si el nombre de categoria es muy corto', async () => {
    const req = { params: { tipo: 'categoria', id: 'A' }, user: ADMIN_USER, ip: '10.0.0.1' };
    const res = mockRes();
    await restaurar(req, res, mockNext);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(query).not.toHaveBeenCalled();
  });

  it('retorna 400 si el nombre de categoria supera los 100 caracteres', async () => {
    const req = { params: { tipo: 'categoria', id: 'a'.repeat(101) }, user: ADMIN_USER, ip: '10.0.0.1' };
    const res = mockRes();
    await restaurar(req, res, mockNext);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('restaura un mapa y responde con mensaje', async () => {
    query.mockResolvedValueOnce({ rows: [{ id: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890' }] });

    const req = { params: { tipo: 'mapa', id: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890' }, user: ADMIN_USER, ip: '10.0.0.1' };
    const res = mockRes();
    await restaurar(req, res, mockNext);

    const [sql] = query.mock.calls[0];
    expect(sql).toMatch(/UPDATE mapas/);
    expect(sql).toMatch(/deleted_at = NULL/);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ message: expect.stringContaining('mapa restaurado') })
    );
    expect(registrarAuditoria).toHaveBeenCalledWith(
      expect.objectContaining({ accion: 'restaurar_mapa' })
    );
  });

  it('restaura un documento', async () => {
    query.mockResolvedValueOnce({ rows: [{ id: 'b2c3d4e5-f6a7-8901-bcde-f12345678901' }] });
    const req = { params: { tipo: 'documento', id: 'b2c3d4e5-f6a7-8901-bcde-f12345678901' }, user: ADMIN_USER, ip: '10.0.0.1' };
    const res = mockRes();
    await restaurar(req, res, mockNext);
    const [sql] = query.mock.calls[0];
    expect(sql).toMatch(/UPDATE documentos/);
  });

  it('usa nombre como columna clave para categorias', async () => {
    query.mockResolvedValueOnce({ rows: [{ nombre: 'Biodiversidad' }] });
    const req = { params: { tipo: 'categoria', id: 'Biodiversidad' }, user: ADMIN_USER, ip: '10.0.0.1' };
    const res = mockRes();
    await restaurar(req, res, mockNext);
    const [sql] = query.mock.calls[0];
    expect(sql).toMatch(/WHERE nombre = \$1/);
  });

  it('retorna 404 si el recurso no existe en la papelera', async () => {
    query.mockResolvedValueOnce({ rows: [] });
    const req = { params: { tipo: 'mapa', id: 'c3d4e5f6-a7b8-9012-cdef-123456789012' }, user: ADMIN_USER, ip: '10.0.0.1' };
    const res = mockRes();
    await restaurar(req, res, mockNext);
    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ error: expect.any(String) }));
  });

  it('llama next(err) ante error de DB', async () => {
    query.mockRejectedValueOnce(new Error('DB fail'));
    const req = { params: { tipo: 'mapa', id: 'd4e5f6a7-b8c9-0123-def0-234567890123' }, user: ADMIN_USER, ip: '10.0.0.1' };
    const res = mockRes();
    await restaurar(req, res, mockNext);
    expect(mockNext).toHaveBeenCalledWith(expect.any(Error));
  });

  it('restaura un geovisor', async () => {
    query.mockResolvedValueOnce({ rows: [{ id: 'e5f6a7b8-c9d0-1234-ef01-345678901234' }] });
    const req = { params: { tipo: 'geovisor', id: 'e5f6a7b8-c9d0-1234-ef01-345678901234' }, user: ADMIN_USER, ip: '10.0.0.1' };
    const res = mockRes();
    await restaurar(req, res, mockNext);
    const [sql] = query.mock.calls[0];
    expect(sql).toMatch(/UPDATE geovisores/);
    expect(registrarAuditoria).toHaveBeenCalledWith(
      expect.objectContaining({ accion: 'restaurar_geovisor' })
    );
  });
});

// ─── purgar() ──────────────────────────────────────────────────────────────────

describe('purgar()', () => {
  beforeEach(() => vi.clearAllMocks());

  it('retorna 400 si tipo es inválido', async () => {
    const req = { params: { tipo: 'invalido', id: 'uuid-1' }, user: ADMIN_USER, ip: '10.0.0.1' };
    const res = mockRes();
    await purgar(req, res, mockNext);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(query).not.toHaveBeenCalled();
  });

  it('retorna 400 si id no es un UUID válido para tipo=geovisor', async () => {
    const req = { params: { tipo: 'geovisor', id: 'no-es-un-uuid' }, user: ADMIN_USER, ip: '10.0.0.1' };
    const res = mockRes();
    await purgar(req, res, mockNext);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(query).not.toHaveBeenCalled();
  });

  it('retorna 400 si el nombre de categoria es muy corto', async () => {
    const req = { params: { tipo: 'categoria', id: 'A' }, user: ADMIN_USER, ip: '10.0.0.1' };
    const res = mockRes();
    await purgar(req, res, mockNext);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(query).not.toHaveBeenCalled();
  });

  it('purga un geovisor -- DELETE físico, solo si ya estaba en papelera', async () => {
    query.mockResolvedValueOnce({ rowCount: 1 });
    const req = { params: { tipo: 'geovisor', id: 'f6a7b8c9-d0e1-2345-f012-456789012345' }, user: ADMIN_USER, ip: '10.0.0.1' };
    const res = mockRes();
    await purgar(req, res, mockNext);

    const [sql, params] = query.mock.calls[0];
    expect(sql).toMatch(/DELETE FROM geovisores/);
    expect(sql).toMatch(/deleted_at IS NOT NULL/);
    expect(params).toEqual(['f6a7b8c9-d0e1-2345-f012-456789012345']);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ message: expect.stringContaining('eliminado permanentemente') })
    );
    expect(registrarAuditoria).toHaveBeenCalledWith(
      expect.objectContaining({ accion: 'purgar_geovisor' })
    );
  });

  it('purga una categoria usando nombre como columna clave', async () => {
    query.mockResolvedValueOnce({ rowCount: 1 });
    const req = { params: { tipo: 'categoria', id: 'Biodiversidad' }, user: ADMIN_USER, ip: '10.0.0.1' };
    const res = mockRes();
    await purgar(req, res, mockNext);
    const [sql] = query.mock.calls[0];
    expect(sql).toMatch(/WHERE nombre = \$1/);
  });

  it('retorna 404 si el recurso no está en la papelera', async () => {
    query.mockResolvedValueOnce({ rowCount: 0 });
    const req = { params: { tipo: 'mapa', id: 'a7b8c9d0-e1f2-3456-0123-567890123456' }, user: ADMIN_USER, ip: '10.0.0.1' };
    const res = mockRes();
    await purgar(req, res, mockNext);
    expect(res.status).toHaveBeenCalledWith(404);
  });

  it('llama next(err) ante error de DB', async () => {
    query.mockRejectedValueOnce(new Error('DB fail'));
    const req = { params: { tipo: 'mapa', id: 'b8c9d0e1-f2a3-4567-1234-678901234567' }, user: ADMIN_USER, ip: '10.0.0.1' };
    const res = mockRes();
    await purgar(req, res, mockNext);
    expect(mockNext).toHaveBeenCalledWith(expect.any(Error));
  });
});
