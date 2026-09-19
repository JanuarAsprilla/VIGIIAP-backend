import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../src/config/database.js', () => ({ query: vi.fn(), getClient: vi.fn() }));

import { query } from '../src/config/database.js';
import { obtener, actualizar } from '../src/modules/notificaciones/prefs.service.js';

beforeEach(() => vi.clearAllMocks());

describe('obtener()', () => {
  it('filtra por audiencia admin+ambos para admin_sig/super_admin', async () => {
    query.mockResolvedValueOnce({ rows: [] });
    await obtener('user-1', 'admin_sig');
    const [, params] = query.mock.calls[0];
    expect(params).toEqual(['user-1', ['admin', 'ambos']]);
  });

  it('filtra por audiencia usuario+ambos para roles sin cuenta admin', async () => {
    query.mockResolvedValueOnce({ rows: [] });
    await obtener('user-1', 'investigador');
    const [, params] = query.mock.calls[0];
    expect(params).toEqual(['user-1', ['usuario', 'ambos']]);
  });

  it('devuelve en_pantalla resuelto vía COALESCE contra la preferencia guardada', async () => {
    const rows = [{ clave: 'nuevo_usuario', nombre: 'Nuevo usuario', icono: 'User', color: 'magenta', en_pantalla: false }];
    query.mockResolvedValueOnce({ rows });
    const result = await obtener('user-1', 'super_admin');
    expect(result).toEqual(rows);
    expect(query.mock.calls[0][0]).toMatch(/COALESCE\(p\.en_pantalla, true\) AS en_pantalla/);
  });
});

describe('actualizar()', () => {
  it('hace upsert de la preferencia cuando el tipo existe', async () => {
    query
      .mockResolvedValueOnce({ rows: [{ '?column?': 1 }] }) // SELECT existencia del tipo
      .mockResolvedValueOnce({ rows: [] });                 // INSERT ... ON CONFLICT

    await actualizar('user-1', 'nuevo_usuario', false);

    const [upsertSql, upsertParams] = query.mock.calls[1];
    expect(upsertSql).toMatch(/ON CONFLICT \(usuario_id, tipo_clave\) DO UPDATE/);
    expect(upsertParams).toEqual(['user-1', 'nuevo_usuario', false]);
  });

  it('lanza 404 si el tipo no existe o está inactivo', async () => {
    query.mockResolvedValueOnce({ rows: [] });
    await expect(actualizar('user-1', 'inexistente', true)).rejects.toMatchObject({ status: 404 });
    expect(query).toHaveBeenCalledTimes(1);
  });
});
