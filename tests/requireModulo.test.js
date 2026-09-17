import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../src/config/database.js', () => ({
  query: vi.fn(),
  getClient: vi.fn(),
}));

import { query } from '../src/config/database.js';
import { requireModulo } from '../src/middlewares/requireModulo.js';

function res() {
  return { status: vi.fn().mockReturnThis(), json: vi.fn() };
}

describe('requireModulo()', () => {
  beforeEach(() => vi.clearAllMocks());

  it('deja pasar a super_admin sin consultar la BD', async () => {
    const next = vi.fn();
    await requireModulo('mapas', 'editar')({ user: { id: 's1', rol: 'super_admin' } }, res(), next);
    expect(next).toHaveBeenCalledWith();
    expect(query).not.toHaveBeenCalled();
  });

  it('deja pasar a un rol que no es admin_sig (ej. investigador subiendo su propio documento)', async () => {
    const next = vi.fn();
    await requireModulo('documentos', 'editar')({ user: { id: 'i1', rol: 'investigador' } }, res(), next);
    expect(next).toHaveBeenCalledWith();
    expect(query).not.toHaveBeenCalled();
  });

  it('bloquea con 403 a un admin_sig sin el módulo habilitado', async () => {
    query.mockResolvedValueOnce({ rows: [] });
    const r = res();
    const next = vi.fn();
    await requireModulo('mapas', 'ver')({ user: { id: 'a1', rol: 'admin_sig' } }, r, next);
    expect(next).not.toHaveBeenCalled();
    expect(r.status).toHaveBeenCalledWith(403);
  });

  it('deja pasar a un admin_sig con el módulo habilitado', async () => {
    query.mockResolvedValueOnce({ rows: [{ puede_ver: true, puede_editar: true }] });
    const next = vi.fn();
    await requireModulo('mapas', 'editar')({ user: { id: 'a1', rol: 'admin_sig' } }, res(), next);
    expect(next).toHaveBeenCalledWith();
  });

  it('llama next(err) si la consulta falla', async () => {
    query.mockRejectedValueOnce(new Error('db down'));
    const next = vi.fn();
    await requireModulo('mapas', 'ver')({ user: { id: 'a1', rol: 'admin_sig' } }, res(), next);
    expect(next).toHaveBeenCalledWith(expect.any(Error));
  });
});
