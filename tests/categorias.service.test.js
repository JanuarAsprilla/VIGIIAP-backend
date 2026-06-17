/**
 * Tests unitarios para categorias.service.js
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../src/config/database.js', () => ({ query: vi.fn(), getClient: vi.fn() }));
vi.mock('../src/config/r2.js', () => ({
  deleteFile: vi.fn().mockResolvedValue(undefined),
  deleteFileByUrl: vi.fn().mockResolvedValue(undefined),
  extractKey: vi.fn((url) => url ? url.split('/').pop() : null),
  uploadFile: vi.fn(),
  getPresignedUrl: vi.fn(),
  isPublicUrl: vi.fn(),
}));

import { query } from '../src/config/database.js';
import { deleteFile } from '../src/config/r2.js';
import { getAll, upsert, remove } from '../src/modules/categorias/categorias.service.js';

const CAT = { nombre: 'Biodiversidad', thumbnail_url: 'https://files.test.local/cat.jpg', actualizado_en: new Date() };

describe('categorias.service → getAll()', () => {
  beforeEach(() => vi.resetAllMocks());

  it('retorna lista de categorías', async () => {
    query.mockResolvedValueOnce({ rows: [CAT] });
    const result = await getAll();
    expect(result).toHaveLength(1);
    expect(result[0].nombre).toBe('Biodiversidad');
    expect(query).toHaveBeenCalledOnce();
  });

  it('retorna lista vacía cuando no hay categorías', async () => {
    query.mockResolvedValueOnce({ rows: [] });
    const result = await getAll();
    expect(result).toEqual([]);
  });
});

describe('categorias.service → upsert()', () => {
  beforeEach(() => vi.resetAllMocks());

  it('crea una categoría nueva y la retorna', async () => {
    query.mockResolvedValueOnce({ rows: [CAT] });
    const result = await upsert('Biodiversidad', 'https://files.test.local/cat.jpg');
    expect(result.nombre).toBe('Biodiversidad');
    const sql = query.mock.calls[0][0];
    expect(sql).toMatch(/ON CONFLICT/);
  });

  it('upsert sin thumbnail_url pasa null', async () => {
    query.mockResolvedValueOnce({ rows: [{ ...CAT, thumbnail_url: null }] });
    const result = await upsert('Biodiversidad');
    const params = query.mock.calls[0][1];
    expect(params[1]).toBeNull();
    expect(result).toBeDefined();
  });
});

describe('categorias.service → remove()', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    deleteFile.mockResolvedValue(undefined);
  });

  it('elimina categoría existente y borra su thumbnail de R2', async () => {
    query
      .mockResolvedValueOnce({ rows: [CAT] })        // SELECT thumbnail_url
      .mockResolvedValueOnce({ rows: [], rowCount: 1 }); // DELETE

    await remove('Biodiversidad');

    expect(query).toHaveBeenCalledTimes(2);
    expect(deleteFile).toHaveBeenCalledOnce();
  });

  it('elimina categoría sin thumbnail sin llamar R2', async () => {
    query
      .mockResolvedValueOnce({ rows: [{ nombre: 'Sin Imagen', thumbnail_url: null }] })
      .mockResolvedValueOnce({ rows: [] });

    await remove('Sin Imagen');

    expect(deleteFile).not.toHaveBeenCalled();
  });

  it('lanza 404 si la categoría no existe', async () => {
    query.mockResolvedValueOnce({ rows: [] });

    await expect(remove('NoExiste')).rejects.toMatchObject({ status: 404 });
    expect(deleteFile).not.toHaveBeenCalled();
  });
});
