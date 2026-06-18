import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Mocks ────────────────────────────────────────────────────────────────────
vi.mock('../src/config/database.js', () => ({
  query: vi.fn(),
  getClient: vi.fn(),
}));

vi.mock('../src/config/r2.js', () => ({
  uploadFile: vi.fn(),
  deleteFileByUrl: vi.fn(),
  deleteFile: vi.fn(),
  extractKey: vi.fn(),
  getPresignedUrl: vi.fn(),
}));

// ─── Imports bajo prueba ───────────────────────────────────────────────────────
import { query } from '../src/config/database.js';
import { deleteFileByUrl } from '../src/config/r2.js';
import {
  getAll,
  getBySlug,
  create,
  update,
  remove,
  setActivo,
} from '../src/modules/mapas/mapas.service.js';

// ─── Fixtures ─────────────────────────────────────────────────────────────────
const mockMapa = {
  id: 'mapa-uuid-001',
  titulo: 'Mapa de Biodiversidad',
  slug: 'mapa-de-biodiversidad',
  categoria: 'biodiversidad',
  anio: 2023,
  descripcion: 'Descripción del mapa',
  thumbnail_url: 'https://files.test.local/thumb.jpg',
  archivo_pdf_url: 'https://files.test.local/mapa.pdf',
  archivo_img_url: null,
  geovisor_url: null,
  activo: true,
  visibilidad: 'publico',
  creado_en: new Date().toISOString(),
};

const adminUser = { id: 'user-001', rol: 'admin_sig' };
const publicUser = { id: 'user-002', rol: 'publico' };
const visitante = { id: 'vis-001', rol: 'visitante' };

// ─── getAll() ────────────────────────────────────────────────────────────────
describe('getAll()', () => {
  beforeEach(() => vi.clearAllMocks());

  it('retorna lista paginada de mapas activos para usuario público', async () => {
    // Promise.all: [data, count]
    query
      .mockResolvedValueOnce({ rows: [mockMapa] })
      .mockResolvedValueOnce({ rows: [{ count: '1' }] });

    const result = await getAll({ page: '1', limit: '10' }, publicUser);

    expect(result.data).toHaveLength(1);
    expect(result.data[0].id).toBe(mockMapa.id);
    expect(result.meta).toMatchObject({ total: 1, page: 1 });
  });

  it('retorna mapas sin filtro de activo cuando admin=true', async () => {
    query
      .mockResolvedValueOnce({ rows: [mockMapa, { ...mockMapa, id: 'mapa-uuid-002', activo: false }] })
      .mockResolvedValueOnce({ rows: [{ count: '2' }] });

    const result = await getAll({ admin: 'true' }, adminUser);

    expect(result.data).toHaveLength(2);
    // La query no debe contener filtro activo=true cuando admin=true
    const dataQuerySql = query.mock.calls[0][0];
    expect(dataQuerySql).not.toContain('m.activo = true');
  });

  it('filtra por visibilidad ["publico"] para visitante', async () => {
    query
      .mockResolvedValueOnce({ rows: [mockMapa] })
      .mockResolvedValueOnce({ rows: [{ count: '1' }] });

    await getAll({ page: '1' }, visitante);

    const dataQueryParams = query.mock.calls[0][1];
    expect(dataQueryParams).toContainEqual(['publico']);
  });

  it('no aplica filtro de visibilidad para admin_sig', async () => {
    query
      .mockResolvedValueOnce({ rows: [mockMapa] })
      .mockResolvedValueOnce({ rows: [{ count: '1' }] });

    await getAll({ page: '1' }, adminUser);

    // Admin no envía array de visibilidad como parámetro en modo normal
    const dataQuerySql = query.mock.calls[0][0];
    expect(dataQuerySql).not.toContain('visibilidad = ANY');
  });

  it('filtra por categoria cuando se provee', async () => {
    query
      .mockResolvedValueOnce({ rows: [mockMapa] })
      .mockResolvedValueOnce({ rows: [{ count: '1' }] });

    await getAll({ categoria: 'biodiversidad' }, adminUser);

    const dataQuerySql = query.mock.calls[0][0];
    expect(dataQuerySql).toContain('m.categoria');
  });

  it('filtra por búsqueda de texto cuando se provee q', async () => {
    query
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ count: '0' }] });

    const result = await getAll({ q: 'biodiversidad' }, publicUser);

    expect(result.data).toHaveLength(0);
    const dataQuerySql = query.mock.calls[0][0];
    expect(dataQuerySql).toContain('ILIKE');
  });

  it('retorna lista vacía cuando no hay mapas', async () => {
    query
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ count: '0' }] });

    const result = await getAll({}, null);

    expect(result.data).toHaveLength(0);
    expect(result.meta.total).toBe(0);
  });
});

// ─── getBySlug() ─────────────────────────────────────────────────────────────
describe('getBySlug()', () => {
  beforeEach(() => vi.clearAllMocks());

  it('retorna el mapa cuando el slug existe', async () => {
    query.mockResolvedValueOnce({ rows: [{ ...mockMapa, autor: 'Admin Test' }] });

    const result = await getBySlug('mapa-de-biodiversidad', publicUser);

    expect(result).toMatchObject({ id: mockMapa.id, slug: mockMapa.slug });
    expect(result.autor).toBe('Admin Test');
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining('WHERE m.slug = $1'),
      expect.arrayContaining(['mapa-de-biodiversidad'])
    );
  });

  it('lanza 404 cuando el slug no existe', async () => {
    query.mockResolvedValueOnce({ rows: [] });

    await expect(getBySlug('slug-inexistente', publicUser)).rejects.toMatchObject({ status: 404 });
  });

  it('aplica filtro de visibilidad para usuario visitante', async () => {
    query.mockResolvedValueOnce({ rows: [mockMapa] });

    await getBySlug('mapa-de-biodiversidad', visitante);

    // Params debe incluir el array de visibilidades
    const callParams = query.mock.calls[0][1];
    expect(callParams[1]).toEqual(['publico']);
  });

  it('no aplica filtro de visibilidad para admin_sig', async () => {
    query.mockResolvedValueOnce({ rows: [mockMapa] });

    await getBySlug('mapa-de-biodiversidad', adminUser);

    const callParams = query.mock.calls[0][1];
    // Solo debe tener el slug como parámetro
    expect(callParams).toHaveLength(1);
    expect(callParams[0]).toBe('mapa-de-biodiversidad');
  });
});

// ─── create() ────────────────────────────────────────────────────────────────
describe('create()', () => {
  beforeEach(() => vi.clearAllMocks());

  const newMapaData = {
    titulo: 'Mapa de Biodiversidad',
    categoria: 'biodiversidad',
    anio: 2023,
    descripcion: 'Descripción',
    thumbnail_url: 'https://files.test.local/thumb.jpg',
    archivo_pdf_url: 'https://files.test.local/mapa.pdf',
    visibilidad: 'publico',
  };

  it('inserta el mapa y retorna el registro creado', async () => {
    query.mockResolvedValueOnce({ rows: [mockMapa] });

    const result = await create(newMapaData, 'user-001');

    expect(result).toMatchObject({ id: mockMapa.id });
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO mapas'),
      expect.arrayContaining(['Mapa de Biodiversidad'])
    );
  });

  it('genera el slug a partir del título', async () => {
    query.mockResolvedValueOnce({ rows: [mockMapa] });

    await create(newMapaData, 'user-001');

    const insertParams = query.mock.calls[0][1];
    // El slug está en índice 1
    expect(insertParams[1]).toBe('mapa-de-biodiversidad');
  });

  it('usa "publico" como visibilidad por defecto cuando no se provee', async () => {
    query.mockResolvedValueOnce({ rows: [{ ...mockMapa, visibilidad: 'publico' }] });

    await create({ ...newMapaData, visibilidad: undefined }, 'user-001');

    const insertParams = query.mock.calls[0][1];
    // visibilidad está en índice 9
    expect(insertParams[9]).toBe('publico');
  });

  it('acepta campos opcionales como null cuando no se proveen', async () => {
    query.mockResolvedValueOnce({ rows: [mockMapa] });

    await create({ titulo: 'Nuevo', categoria: 'general', anio: 2024, descripcion: '' }, 'user-001');

    const insertParams = query.mock.calls[0][1];
    expect(insertParams[5]).toBeNull(); // thumbnail_url → null
    expect(insertParams[6]).toBeNull(); // archivo_pdf_url → null
  });
});

// ─── update() ────────────────────────────────────────────────────────────────
describe('update()', () => {
  beforeEach(() => vi.clearAllMocks());

  it('actualiza los campos provistos y retorna el mapa actualizado', async () => {
    const updatedMapa = { ...mockMapa, titulo: 'Nuevo Título' };
    query.mockResolvedValueOnce({ rows: [updatedMapa] });

    const result = await update('mapa-uuid-001', { titulo: 'Nuevo Título' });

    expect(result.titulo).toBe('Nuevo Título');
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE mapas SET'),
      expect.arrayContaining(['Nuevo Título', 'mapa-uuid-001'])
    );
  });

  it('lanza 404 cuando el id no existe', async () => {
    query.mockResolvedValueOnce({ rows: [] });

    await expect(update('uuid-inexistente', { titulo: 'X' })).rejects.toMatchObject({ status: 404 });
  });

  it('lanza 400 cuando no se proveen campos para actualizar', async () => {
    await expect(update('mapa-uuid-001', {})).rejects.toMatchObject({ status: 400 });
    expect(query).not.toHaveBeenCalled();
  });

  it('incluye "actualizado_en = NOW()" en cada UPDATE', async () => {
    query.mockResolvedValueOnce({ rows: [mockMapa] });

    await update('mapa-uuid-001', { categoria: 'fauna' });

    const updateSql = query.mock.calls[0][0];
    expect(updateSql).toContain('actualizado_en = NOW()');
  });
});

// ─── setActivo() ─────────────────────────────────────────────────────────────
describe('setActivo()', () => {
  beforeEach(() => vi.clearAllMocks());

  it('activa el mapa y retorna el registro actualizado', async () => {
    query.mockResolvedValueOnce({ rows: [{ ...mockMapa, activo: true }] });

    const result = await setActivo('mapa-uuid-001', true);

    expect(result.activo).toBe(true);
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining('activo=$1'),
      [true, 'mapa-uuid-001']
    );
  });

  it('lanza 404 cuando el id no existe', async () => {
    query.mockResolvedValueOnce({ rows: [] });

    await expect(setActivo('uuid-inexistente', false)).rejects.toMatchObject({ status: 404 });
  });
});

// ─── remove() ────────────────────────────────────────────────────────────────
describe('remove()', () => {
  beforeEach(() => vi.clearAllMocks());

  it('hace soft delete del mapa y borra sus archivos de R2', async () => {
    query
      .mockResolvedValueOnce({
        rows: [{
          archivo_pdf_url: 'https://files.test.local/mapa.pdf',
          archivo_img_url: 'https://files.test.local/mapa.jpg',
          thumbnail_url: 'https://files.test.local/thumb.jpg',
        }],
      })
      .mockResolvedValueOnce({ rows: [] }); // UPDATE deleted_at

    deleteFileByUrl.mockResolvedValue(undefined);

    await remove('mapa-uuid-001');

    const updateCall = query.mock.calls.find(([sql]) => sql.includes('deleted_at'));
    expect(updateCall).toBeDefined();
    expect(deleteFileByUrl).toHaveBeenCalledTimes(3);
  });

  it('no llama a deleteFileByUrl si las URLs son null', async () => {
    query
      .mockResolvedValueOnce({
        rows: [{ archivo_pdf_url: null, archivo_img_url: null, thumbnail_url: null }],
      })
      .mockResolvedValueOnce({ rows: [] });

    await remove('mapa-uuid-001');

    expect(deleteFileByUrl).not.toHaveBeenCalled();
  });

  it('lanza 404 cuando el mapa no existe o ya fue eliminado', async () => {
    query.mockResolvedValueOnce({ rows: [] });

    await expect(remove('uuid-inexistente')).rejects.toMatchObject({ status: 404 });
    // No debe intentar UPDATE
    expect(query).toHaveBeenCalledTimes(1);
  });

  it('solo borra las URLs que no son null', async () => {
    query
      .mockResolvedValueOnce({
        rows: [{
          archivo_pdf_url: 'https://files.test.local/mapa.pdf',
          archivo_img_url: null,
          thumbnail_url: 'https://files.test.local/thumb.jpg',
        }],
      })
      .mockResolvedValueOnce({ rows: [] });

    deleteFileByUrl.mockResolvedValue(undefined);

    await remove('mapa-uuid-001');

    expect(deleteFileByUrl).toHaveBeenCalledTimes(2);
  });
});
