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
} from '../src/modules/documentos/documentos.service.js';

// ─── Fixtures ─────────────────────────────────────────────────────────────────
const mockDocumento = {
  id: 'doc-uuid-001',
  titulo: 'Informe Biodiversidad 2023',
  slug: 'informe-biodiversidad-2023',
  tipo: 'informe',
  anio: 2023,
  autores: 'Juan Pérez',
  resumen: 'Resumen del informe',
  archivo_url: 'https://files.test.local/doc.pdf',
  tamano_bytes: 1024000,
  visibilidad: 'publico',
  activo: true,
  creado_en: new Date().toISOString(),
};

const adminUser = { id: 'user-001', rol: 'admin_sig' };
const investigador = { id: 'user-002', rol: 'investigador' };
const publicUser = { id: 'user-003', rol: 'publico' };
const visitante = { id: 'vis-001', rol: 'visitante' };

// ─── getAll() ────────────────────────────────────────────────────────────────
describe('getAll()', () => {
  beforeEach(() => vi.clearAllMocks());

  it('retorna lista paginada de documentos activos y públicos', async () => {
    query
      .mockResolvedValueOnce({ rows: [mockDocumento] })
      .mockResolvedValueOnce({ rows: [{ count: '1' }] });

    const result = await getAll({ page: '1', limit: '10' }, publicUser);

    expect(result.data).toHaveLength(1);
    expect(result.data[0].id).toBe(mockDocumento.id);
    expect(result.meta).toMatchObject({ total: 1, page: 1 });
  });

  it('siempre incluye filtro activo=true', async () => {
    query
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ count: '0' }] });

    await getAll({}, publicUser);

    const dataQuerySql = query.mock.calls[0][0];
    expect(dataQuerySql).toContain('d.activo = true');
  });

  it('panel admin ve documentos sin filtro de visibilidad', async () => {
    query
      .mockResolvedValueOnce({ rows: [mockDocumento] })
      .mockResolvedValueOnce({ rows: [{ count: '1' }] });

    await getAll({ admin: 'true' }, adminUser);

    const dataQuerySql = query.mock.calls[0][0];
    expect(dataQuerySql).not.toContain('visibilidad = ANY');
  });

  it('filtra visibilidad a ["publico"] para usuario visitante', async () => {
    query
      .mockResolvedValueOnce({ rows: [mockDocumento] })
      .mockResolvedValueOnce({ rows: [{ count: '1' }] });

    await getAll({}, visitante);

    const dataQueryParams = query.mock.calls[0][1];
    expect(dataQueryParams).toContainEqual(['publico']);
  });

  it('no aplica filtro de visibilidad para investigador', async () => {
    query
      .mockResolvedValueOnce({ rows: [mockDocumento] })
      .mockResolvedValueOnce({ rows: [{ count: '1' }] });

    await getAll({}, investigador);

    const dataQuerySql = query.mock.calls[0][0];
    expect(dataQuerySql).not.toContain('visibilidad = ANY');
  });

  it('filtra por tipo cuando se provee', async () => {
    query
      .mockResolvedValueOnce({ rows: [mockDocumento] })
      .mockResolvedValueOnce({ rows: [{ count: '1' }] });

    await getAll({ tipo: 'informe' }, publicUser);

    const dataQuerySql = query.mock.calls[0][0];
    expect(dataQuerySql).toContain('d.tipo');
  });

  it('filtra por anio cuando se provee', async () => {
    query
      .mockResolvedValueOnce({ rows: [mockDocumento] })
      .mockResolvedValueOnce({ rows: [{ count: '1' }] });

    await getAll({ anio: '2023' }, publicUser);

    const dataQuerySql = query.mock.calls[0][0];
    expect(dataQuerySql).toContain('d.anio');
  });

  it('filtra por texto cuando se provee q', async () => {
    query
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ count: '0' }] });

    await getAll({ q: 'biodiversidad' }, publicUser);

    const dataQuerySql = query.mock.calls[0][0];
    expect(dataQuerySql).toContain('ILIKE');
  });

  it('retorna meta con paginación correcta', async () => {
    query
      .mockResolvedValueOnce({ rows: Array(10).fill(mockDocumento) })
      .mockResolvedValueOnce({ rows: [{ count: '25' }] });

    const result = await getAll({ page: '2', limit: '10' }, publicUser);

    expect(result.meta).toMatchObject({
      total: 25,
      page: 2,
      limit: 10,
      totalPages: 3,
      hasPrev: true,
      hasNext: true,
    });
  });
});

// ─── getBySlug() ─────────────────────────────────────────────────────────────
describe('getBySlug()', () => {
  beforeEach(() => vi.clearAllMocks());

  it('retorna el documento cuando el slug existe', async () => {
    query.mockResolvedValueOnce({ rows: [{ ...mockDocumento, autor: 'Juan Pérez' }] });

    const result = await getBySlug('informe-biodiversidad-2023', publicUser);

    expect(result).toMatchObject({ id: mockDocumento.id, slug: mockDocumento.slug });
    expect(result.autor).toBe('Juan Pérez');
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining('WHERE d.slug = $1'),
      expect.arrayContaining(['informe-biodiversidad-2023'])
    );
  });

  it('lanza 404 cuando el slug no existe', async () => {
    query.mockResolvedValueOnce({ rows: [] });

    await expect(getBySlug('slug-inexistente', publicUser)).rejects.toMatchObject({ status: 404 });
  });

  it('aplica filtro de visibilidad para usuario visitante', async () => {
    query.mockResolvedValueOnce({ rows: [mockDocumento] });

    await getBySlug('informe-biodiversidad-2023', visitante);

    const callParams = query.mock.calls[0][1];
    expect(callParams[1]).toEqual(['publico']);
  });

  it('no aplica filtro de visibilidad para admin_sig', async () => {
    query.mockResolvedValueOnce({ rows: [mockDocumento] });

    await getBySlug('informe-biodiversidad-2023', adminUser);

    const callParams = query.mock.calls[0][1];
    expect(callParams).toHaveLength(1);
    expect(callParams[0]).toBe('informe-biodiversidad-2023');
  });

  it('lanza 404 para usuario visitante cuando documento es de visibilidad "usuarios"', async () => {
    // La query con filtro de visibilidad no encuentra nada
    query.mockResolvedValueOnce({ rows: [] });

    await expect(
      getBySlug('doc-solo-usuarios', visitante)
    ).rejects.toMatchObject({ status: 404 });
  });
});

// ─── create() ────────────────────────────────────────────────────────────────
describe('create()', () => {
  beforeEach(() => vi.clearAllMocks());

  const newDocData = {
    titulo: 'Informe Biodiversidad 2023',
    tipo: 'informe',
    anio: 2023,
    autores: 'Juan Pérez',
    resumen: 'Resumen del informe',
    archivo_url: 'https://files.test.local/doc.pdf',
    archivo_tamano_bytes: 1024000,
    visibilidad: 'publico',
  };

  it('inserta el documento y retorna el registro creado', async () => {
    query.mockResolvedValueOnce({ rows: [mockDocumento] });

    const result = await create(newDocData, 'user-001');

    expect(result).toMatchObject({ id: mockDocumento.id });
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO documentos'),
      expect.arrayContaining(['Informe Biodiversidad 2023'])
    );
  });

  it('genera el slug a partir del título', async () => {
    query.mockResolvedValueOnce({ rows: [mockDocumento] });

    await create(newDocData, 'user-001');

    const insertParams = query.mock.calls[0][1];
    expect(insertParams[1]).toBe('informe-biodiversidad-2023');
  });

  it('pasa tamano_bytes desde archivo_tamano_bytes', async () => {
    query.mockResolvedValueOnce({ rows: [mockDocumento] });

    await create({ ...newDocData, archivo_tamano_bytes: 512000 }, 'user-001');

    const insertParams = query.mock.calls[0][1];
    expect(insertParams[7]).toBe(512000);
  });

  it('usa null para tamano_bytes cuando no se provee', async () => {
    query.mockResolvedValueOnce({ rows: [mockDocumento] });

    await create({ ...newDocData, archivo_tamano_bytes: undefined }, 'user-001');

    const insertParams = query.mock.calls[0][1];
    expect(insertParams[7]).toBeNull();
  });

  it('usa "publico" como visibilidad por defecto cuando no se provee', async () => {
    query.mockResolvedValueOnce({ rows: [mockDocumento] });

    await create({ ...newDocData, visibilidad: undefined }, 'user-001');

    const insertParams = query.mock.calls[0][1];
    expect(insertParams[8]).toBe('publico');
  });
});

// ─── create() — permiso condicional para rol 'investigador' (investigadorCanUpload) ──
describe('create() → permiso investigador (config investigadorCanUpload)', () => {
  beforeEach(() => vi.clearAllMocks());

  const newDocData = {
    titulo: 'Informe Biodiversidad 2023',
    tipo: 'informe',
    anio: 2023,
    autores: 'Juan Pérez',
    resumen: 'Resumen del informe',
    archivo_url: 'https://files.test.local/doc.pdf',
    archivo_tamano_bytes: 1024000,
    visibilidad: 'publico',
  };

  it('bloquea a investigador con 403 cuando investigadorCanUpload está ausente en configuracion (default seguro)', async () => {
    query.mockResolvedValueOnce({ rows: [] }); // sin fila de config → indefinido
    await expect(
      create(newDocData, 'user-002', 'investigador')
    ).rejects.toMatchObject({ status: 403 });
    expect(query).toHaveBeenCalledOnce(); // nunca llega al INSERT
  });

  it('bloquea a investigador con 403 cuando investigadorCanUpload="false"', async () => {
    query.mockResolvedValueOnce({ rows: [{ valor: 'false' }] });
    await expect(
      create(newDocData, 'user-002', 'investigador')
    ).rejects.toMatchObject({ status: 403 });
    expect(query).toHaveBeenCalledOnce();
  });

  it('permite a investigador crear el documento cuando investigadorCanUpload="true"', async () => {
    query
      .mockResolvedValueOnce({ rows: [{ valor: 'true' }] }) // config
      .mockResolvedValueOnce({ rows: [mockDocumento] });     // INSERT

    const result = await create(newDocData, 'user-002', 'investigador');
    expect(result.id).toBe(mockDocumento.id);
    expect(query).toHaveBeenCalledTimes(2);
  });

  it('no consulta configuracion para admin_sig (sin cambio de comportamiento)', async () => {
    query.mockResolvedValueOnce({ rows: [mockDocumento] }); // INSERT

    const result = await create(newDocData, 'user-001', 'admin_sig');
    expect(result.id).toBe(mockDocumento.id);
    expect(query).toHaveBeenCalledOnce(); // sin la query extra de config
  });
});

// ─── update() ────────────────────────────────────────────────────────────────
describe('update()', () => {
  beforeEach(() => vi.clearAllMocks());

  it('actualiza los campos provistos y retorna el documento actualizado', async () => {
    const updatedDoc = { ...mockDocumento, titulo: 'Nuevo Título' };
    query.mockResolvedValueOnce({ rows: [updatedDoc] });

    const result = await update('doc-uuid-001', { titulo: 'Nuevo Título' });

    expect(result.titulo).toBe('Nuevo Título');
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE documentos SET'),
      expect.arrayContaining(['Nuevo Título', 'doc-uuid-001'])
    );
  });

  it('lanza 404 cuando el id no existe o el documento no está activo', async () => {
    query.mockResolvedValueOnce({ rows: [] });

    await expect(update('uuid-inexistente', { titulo: 'X' })).rejects.toMatchObject({ status: 404 });
  });

  it('lanza 400 cuando no se proveen campos para actualizar', async () => {
    await expect(update('doc-uuid-001', {})).rejects.toMatchObject({ status: 400 });
    expect(query).not.toHaveBeenCalled();
  });

  it('mapea archivo_tamano_bytes a tamano_bytes antes de actualizar', async () => {
    query.mockResolvedValueOnce({ rows: [mockDocumento] });

    await update('doc-uuid-001', { archivo_tamano_bytes: 999 });

    const updateSql = query.mock.calls[0][0];
    expect(updateSql).toContain('tamano_bytes');
  });

  it('incluye "actualizado_en = NOW()" en cada UPDATE', async () => {
    query.mockResolvedValueOnce({ rows: [mockDocumento] });

    await update('doc-uuid-001', { tipo: 'articulo' });

    const updateSql = query.mock.calls[0][0];
    expect(updateSql).toContain('actualizado_en = NOW()');
  });

  it('solo actualiza los campos explícitamente provistos', async () => {
    query.mockResolvedValueOnce({ rows: [mockDocumento] });

    await update('doc-uuid-001', { anio: 2024 });

    const updateSql = query.mock.calls[0][0];
    // Debe contener anio pero no campos no provistos como titulo
    expect(updateSql).toContain('anio');
    expect(updateSql).not.toContain('titulo =');
  });
});

// ─── remove() ────────────────────────────────────────────────────────────────
describe('remove()', () => {
  // resetAllMocks limpia la cola mockResolvedValueOnce entre tests — evita que
  // mocks sobrantes de un test "contaminen" el siguiente (clearAllMocks no lo hace).
  beforeEach(() => vi.resetAllMocks());

  it('hace soft delete y borra el archivo de R2', async () => {
    // remove() ahora hace UPDATE...RETURNING en 1 sola query (no SELECT + UPDATE separados)
    query
      .mockResolvedValueOnce({ rows: [{ archivo_url: 'https://files.test.local/doc.pdf' }] });

    deleteFileByUrl.mockResolvedValue(undefined);

    await remove('doc-uuid-001');

    // Debe usar UPDATE, no DELETE
    const updateCall = query.mock.calls.find(([sql]) => sql.includes('deleted_at'));
    expect(updateCall).toBeDefined();
    expect(deleteFileByUrl).toHaveBeenCalledWith('https://files.test.local/doc.pdf');
  });

  it('no llama a deleteFileByUrl si archivo_url es null', async () => {
    query.mockResolvedValueOnce({ rows: [{ archivo_url: null }] });

    await remove('doc-uuid-001');

    expect(deleteFileByUrl).not.toHaveBeenCalled();
  });

  it('lanza 404 cuando el documento no existe o ya fue eliminado', async () => {
    query.mockResolvedValueOnce({ rows: [] });

    await expect(remove('uuid-inexistente')).rejects.toMatchObject({ status: 404 });
  });

  it('no interrumpe el flujo si deleteFileByUrl falla', async () => {
    query.mockResolvedValueOnce({ rows: [{ archivo_url: 'https://files.test.local/doc.pdf' }] });
    deleteFileByUrl.mockRejectedValue(new Error('R2 error'));

    await expect(remove('doc-uuid-001')).resolves.toBeUndefined();
  });
});

// ─── setActivo() ────────────────────────────────────────────────────────────
describe('setActivo()', () => {
  beforeEach(() => vi.clearAllMocks());

  it('activa el documento y retorna el registro actualizado', async () => {
    query.mockResolvedValueOnce({ rows: [{ ...mockDocumento, activo: true }] });

    const result = await setActivo('doc-uuid-001', true);

    expect(result.activo).toBe(true);
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining('activo=$1'),
      [true, 'doc-uuid-001']
    );
  });

  it('lanza 404 cuando el id no existe', async () => {
    query.mockResolvedValueOnce({ rows: [] });

    await expect(setActivo('uuid-inexistente', false)).rejects.toMatchObject({ status: 404 });
  });
});
