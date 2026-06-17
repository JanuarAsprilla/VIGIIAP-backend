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
import { deleteFile } from '../src/config/r2.js';
import {
  getAll,
  getBySlug,
  create,
  update,
  remove,
} from '../src/modules/noticias/noticias.service.js';

// ─── Fixtures ─────────────────────────────────────────────────────────────────
const mockNoticia = {
  id: 'noticia-uuid-001',
  titulo: 'Gran descubrimiento en la Amazonía',
  slug: 'gran-descubrimiento-en-la-amazonia',
  categoria: 'investigacion',
  resumen: 'Resumen de la noticia',
  imagen_url: 'https://files.test.local/noticia.jpg',
  publicado: true,
  publicado_en: new Date().toISOString(),
  visibilidad: 'publico',
  creado_en: new Date().toISOString(),
};

const adminUser = { id: 'user-001', rol: 'admin_sig' };
const investigador = { id: 'user-002', rol: 'investigador' };
const publicUser = { id: 'user-003', rol: 'publico' };
const visitante = { id: 'vis-001', rol: 'visitante' };

// ─── getAll() ────────────────────────────────────────────────────────────────
describe('getAll()', () => {
  beforeEach(() => vi.clearAllMocks());

  it('retorna solo noticias publicadas por defecto', async () => {
    query
      .mockResolvedValueOnce({ rows: [mockNoticia] })
      .mockResolvedValueOnce({ rows: [{ count: '1' }] });

    const result = await getAll({}, publicUser);

    expect(result.data).toHaveLength(1);
    const dataQuerySql = query.mock.calls[0][0];
    expect(dataQuerySql).toContain('n.publicado = true');
  });

  it('admin puede ver noticias no publicadas con admin=true', async () => {
    const unpublished = { ...mockNoticia, publicado: false, publicado_en: null };
    query
      .mockResolvedValueOnce({ rows: [mockNoticia, unpublished] })
      .mockResolvedValueOnce({ rows: [{ count: '2' }] });

    const result = await getAll({ admin: 'true' }, adminUser);

    expect(result.data).toHaveLength(2);
    const dataQuerySql = query.mock.calls[0][0];
    expect(dataQuerySql).not.toContain('n.publicado = true');
  });

  it('filtra visibilidad a ["publico"] para visitante', async () => {
    query
      .mockResolvedValueOnce({ rows: [mockNoticia] })
      .mockResolvedValueOnce({ rows: [{ count: '1' }] });

    await getAll({}, visitante);

    const dataQueryParams = query.mock.calls[0][1];
    expect(dataQueryParams).toContainEqual(['publico']);
  });

  it('no aplica filtro de visibilidad para investigador', async () => {
    query
      .mockResolvedValueOnce({ rows: [mockNoticia] })
      .mockResolvedValueOnce({ rows: [{ count: '1' }] });

    await getAll({}, investigador);

    const dataQuerySql = query.mock.calls[0][0];
    expect(dataQuerySql).not.toContain('visibilidad = ANY');
  });

  it('filtra por categoria cuando se provee', async () => {
    query
      .mockResolvedValueOnce({ rows: [mockNoticia] })
      .mockResolvedValueOnce({ rows: [{ count: '1' }] });

    await getAll({ categoria: 'investigacion' }, publicUser);

    const dataQuerySql = query.mock.calls[0][0];
    expect(dataQuerySql).toContain('n.categoria');
  });

  it('filtra por texto cuando se provee q', async () => {
    query
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ count: '0' }] });

    await getAll({ q: 'amazonia' }, publicUser);

    const dataQuerySql = query.mock.calls[0][0];
    expect(dataQuerySql).toContain('ILIKE');
  });

  it('retorna lista vacía y meta correcta cuando no hay noticias', async () => {
    query
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ count: '0' }] });

    const result = await getAll({}, publicUser);

    expect(result.data).toHaveLength(0);
    expect(result.meta.total).toBe(0);
  });

  it('usa COALESCE(publicado_en, creado_en) para el orden', async () => {
    query
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ count: '0' }] });

    await getAll({}, publicUser);

    const dataQuerySql = query.mock.calls[0][0];
    expect(dataQuerySql).toContain('COALESCE');
  });

  it('retorna meta con paginación correcta', async () => {
    query
      .mockResolvedValueOnce({ rows: Array(5).fill(mockNoticia) })
      .mockResolvedValueOnce({ rows: [{ count: '15' }] });

    const result = await getAll({ page: '2', limit: '5' }, publicUser);

    expect(result.meta).toMatchObject({
      total: 15,
      page: 2,
      limit: 5,
      totalPages: 3,
      hasPrev: true,
      hasNext: true,
    });
  });
});

// ─── getBySlug() ─────────────────────────────────────────────────────────────
describe('getBySlug()', () => {
  beforeEach(() => vi.clearAllMocks());

  it('retorna la noticia cuando el slug existe', async () => {
    query.mockResolvedValueOnce({ rows: [{ ...mockNoticia, autor: 'Admin Test' }] });

    const result = await getBySlug('gran-descubrimiento-en-la-amazonia', publicUser);

    expect(result).toMatchObject({ id: mockNoticia.id, slug: mockNoticia.slug });
    expect(result.autor).toBe('Admin Test');
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining('WHERE n.slug = $1'),
      expect.arrayContaining(['gran-descubrimiento-en-la-amazonia'])
    );
  });

  it('lanza 404 cuando el slug no existe', async () => {
    query.mockResolvedValueOnce({ rows: [] });

    await expect(getBySlug('slug-inexistente', publicUser)).rejects.toMatchObject({ status: 404 });
  });

  it('aplica filtro de visibilidad para visitante', async () => {
    query.mockResolvedValueOnce({ rows: [mockNoticia] });

    await getBySlug('gran-descubrimiento-en-la-amazonia', visitante);

    const callParams = query.mock.calls[0][1];
    expect(callParams[1]).toEqual(['publico']);
  });

  it('no aplica filtro de visibilidad para admin_sig', async () => {
    query.mockResolvedValueOnce({ rows: [mockNoticia] });

    await getBySlug('gran-descubrimiento-en-la-amazonia', adminUser);

    const callParams = query.mock.calls[0][1];
    expect(callParams).toHaveLength(1);
    expect(callParams[0]).toBe('gran-descubrimiento-en-la-amazonia');
  });

  it('solo retorna noticias publicadas (publicado=true en SQL)', async () => {
    query.mockResolvedValueOnce({ rows: [] });

    await expect(getBySlug('noticia-no-publicada', publicUser)).rejects.toMatchObject({ status: 404 });

    const dataQuerySql = query.mock.calls[0][0];
    expect(dataQuerySql).toContain('n.publicado = true');
  });
});

// ─── create() ────────────────────────────────────────────────────────────────
describe('create()', () => {
  beforeEach(() => vi.clearAllMocks());

  const newNoticiaData = {
    titulo: 'Gran descubrimiento en la Amazonía',
    categoria: 'investigacion',
    resumen: 'Resumen de la noticia',
    contenido: '<p>Contenido completo</p>',
    imagen_url: 'https://files.test.local/noticia.jpg',
    publicado: true,
    visibilidad: 'publico',
  };

  it('inserta la noticia y retorna el registro creado', async () => {
    query.mockResolvedValueOnce({ rows: [mockNoticia] });

    const result = await create(newNoticiaData, 'user-001');

    expect(result).toMatchObject({ id: mockNoticia.id });
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO noticias'),
      expect.arrayContaining(['Gran descubrimiento en la Amazonía'])
    );
  });

  it('genera el slug a partir del título', async () => {
    query.mockResolvedValueOnce({ rows: [mockNoticia] });

    await create(newNoticiaData, 'user-001');

    const insertParams = query.mock.calls[0][1];
    expect(insertParams[1]).toBe('gran-descubrimiento-en-la-amazonia');
  });

  it('usa null para imagen_url cuando no se provee', async () => {
    query.mockResolvedValueOnce({ rows: [mockNoticia] });

    await create({ ...newNoticiaData, imagen_url: undefined }, 'user-001');

    const insertParams = query.mock.calls[0][1];
    expect(insertParams[5]).toBeNull(); // imagen_url → null
  });

  it('usa false para publicado cuando no se provee', async () => {
    query.mockResolvedValueOnce({ rows: [{ ...mockNoticia, publicado: false }] });

    await create({ ...newNoticiaData, publicado: undefined }, 'user-001');

    const insertParams = query.mock.calls[0][1];
    expect(insertParams[6]).toBe(false); // publicado → false
  });

  it('usa "publico" como visibilidad por defecto', async () => {
    query.mockResolvedValueOnce({ rows: [mockNoticia] });

    await create({ ...newNoticiaData, visibilidad: undefined }, 'user-001');

    const insertParams = query.mock.calls[0][1];
    expect(insertParams[7]).toBe('publico'); // visibilidad → 'publico'
  });

  it('usa CASE WHEN publicado THEN NOW() para publicado_en', async () => {
    query.mockResolvedValueOnce({ rows: [mockNoticia] });

    await create(newNoticiaData, 'user-001');

    const insertSql = query.mock.calls[0][0];
    expect(insertSql).toContain('CASE WHEN');
    expect(insertSql).toContain('NOW()');
  });
});

// ─── update() ────────────────────────────────────────────────────────────────
describe('update()', () => {
  beforeEach(() => vi.clearAllMocks());

  it('actualiza los campos provistos y retorna la noticia actualizada', async () => {
    const updated = { ...mockNoticia, titulo: 'Nuevo Título' };
    query.mockResolvedValueOnce({ rows: [updated] });

    const result = await update('noticia-uuid-001', { titulo: 'Nuevo Título' });

    expect(result.titulo).toBe('Nuevo Título');
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE noticias SET'),
      expect.arrayContaining(['Nuevo Título', 'noticia-uuid-001'])
    );
  });

  it('lanza 404 cuando el id no existe', async () => {
    query.mockResolvedValueOnce({ rows: [] });

    await expect(update('uuid-inexistente', { titulo: 'X' })).rejects.toMatchObject({ status: 404 });
  });

  it('lanza 400 cuando no se proveen campos para actualizar', async () => {
    await expect(update('noticia-uuid-001', {})).rejects.toMatchObject({ status: 400 });
    expect(query).not.toHaveBeenCalled();
  });

  it('incluye lógica de publicado_en cuando se actualiza publicado', async () => {
    query.mockResolvedValueOnce({ rows: [mockNoticia] });

    await update('noticia-uuid-001', { publicado: true });

    const updateSql = query.mock.calls[0][0];
    expect(updateSql).toContain('publicado_en');
    expect(updateSql).toContain('CASE WHEN');
  });

  it('incluye "actualizado_en = NOW()" en cada UPDATE', async () => {
    query.mockResolvedValueOnce({ rows: [mockNoticia] });

    await update('noticia-uuid-001', { categoria: 'evento' });

    const updateSql = query.mock.calls[0][0];
    expect(updateSql).toContain('actualizado_en = NOW()');
  });

  it('actualiza resumen sin afectar otros campos', async () => {
    query.mockResolvedValueOnce({ rows: [{ ...mockNoticia, resumen: 'Nuevo resumen' }] });

    const result = await update('noticia-uuid-001', { resumen: 'Nuevo resumen' });

    expect(result.resumen).toBe('Nuevo resumen');
    const updateSql = query.mock.calls[0][0];
    expect(updateSql).toContain('resumen');
    expect(updateSql).not.toContain('titulo =');
  });
});

// ─── remove() ────────────────────────────────────────────────────────────────
describe('remove()', () => {
  beforeEach(() => vi.clearAllMocks());

  it('elimina la noticia de BD y borra su imagen de R2', async () => {
    query
      .mockResolvedValueOnce({ rows: [{ imagen_url: 'https://files.test.local/R2_PUBLIC_URL/noticia.jpg' }] })
      .mockResolvedValueOnce({ rows: [] });

    deleteFile.mockResolvedValue(undefined);

    await remove('noticia-uuid-001');

    expect(query).toHaveBeenCalledWith('DELETE FROM noticias WHERE id=$1', ['noticia-uuid-001']);
    expect(deleteFile).toHaveBeenCalled();
  });

  it('no llama a deleteFile si imagen_url es null', async () => {
    query
      .mockResolvedValueOnce({ rows: [{ imagen_url: null }] })
      .mockResolvedValueOnce({ rows: [] });

    await remove('noticia-uuid-001');

    expect(deleteFile).not.toHaveBeenCalled();
  });

  it('retorna sin error cuando la noticia no existe', async () => {
    query.mockResolvedValueOnce({ rows: [] });

    await expect(remove('uuid-inexistente')).resolves.toBeUndefined();
    expect(query).toHaveBeenCalledTimes(1);
  });

  it('no interrumpe el flujo si deleteFile falla', async () => {
    query
      .mockResolvedValueOnce({ rows: [{ imagen_url: 'https://files.test.local/noticia.jpg' }] })
      .mockResolvedValueOnce({ rows: [] });

    deleteFile.mockRejectedValue(new Error('R2 error'));

    await expect(remove('noticia-uuid-001')).resolves.toBeUndefined();
  });

  it('extrae la key de la URL para llamar a deleteFile con la key, no con la URL completa', async () => {
    // El servicio usa extractKey interno, no el de r2.js
    // Con R2_PUBLIC_URL = 'https://files.test.local' (definido en setup.js)
    // la key debería ser el segmento después del dominio
    query
      .mockResolvedValueOnce({ rows: [{ imagen_url: 'https://files.test.local/noticia.jpg' }] })
      .mockResolvedValueOnce({ rows: [] });

    deleteFile.mockResolvedValue(undefined);

    await remove('noticia-uuid-001');

    // deleteFile se llama con la key extraída, no con la URL completa
    const calledKey = deleteFile.mock.calls[0][0];
    expect(calledKey).not.toContain('https://');
  });
});
