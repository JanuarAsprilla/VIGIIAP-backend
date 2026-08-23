/**
 * Tests unitarios para solicitudes.service.js
 * Mockea BD. Sin supertest. Sin conexión real.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../src/config/database.js', () => ({
  query: vi.fn(),
  getClient: vi.fn(),
}));

vi.mock('../src/utils/auditLog.js', () => ({
  registrarAuditoria: vi.fn(),
}));

vi.mock('../src/config/r2.js', () => ({
  uploadFile:      vi.fn().mockResolvedValue('https://files.test.local/sol/doc.pdf'),
  deleteFile:      vi.fn().mockResolvedValue(undefined),
  deleteFileByUrl: vi.fn().mockResolvedValue(undefined),
  extractKey:      vi.fn((url) => url?.split('/').pop() ?? null),
  isPublicUrl:     vi.fn((url) => !!url?.startsWith('https://files.test.local')),
  getPresignedUrl: vi.fn().mockResolvedValue('https://presigned.test.local/file'),
}));

import { query } from '../src/config/database.js';
import {
  getAll,
  getMine,
  create,
  updateEstado,
  responder,
} from '../src/modules/solicitudes/solicitudes.service.js';

// ─── Fixture ──────────────────────────────────────────────────────────────────
const SOL = {
  id: 'sol-uuid-1',
  tipo: 'uso-suelo',
  descripcion: 'Solicito acceso a datos de biodiversidad',
  estado: 'pendiente',
  usuario_id: 'usr-uuid-1',
  nota_admin: null,
  creado_en: new Date().toISOString(),
};

// ─── getAll() ─────────────────────────────────────────────────────────────────
describe('solicitudes.service → getAll()', () => {
  beforeEach(() => vi.clearAllMocks());

  it('retorna lista paginada con meta por defecto (page=1, limit=20)', async () => {
    query
      .mockResolvedValueOnce({ rows: [SOL] })
      .mockResolvedValueOnce({ rows: [{ count: '1' }] });

    const result = await getAll({});
    expect(result.data).toHaveLength(1);
    expect(result.data[0].id).toBe('sol-uuid-1');
    expect(result.meta).toMatchObject({ total: 1, page: 1, limit: 20 });
  });

  it('filtra por estado cuando el estado es válido', async () => {
    query
      .mockResolvedValueOnce({ rows: [{ ...SOL, estado: 'aprobada' }] })
      .mockResolvedValueOnce({ rows: [{ count: '1' }] });

    const result = await getAll({ estado: 'aprobada' });
    const firstCallParams = query.mock.calls[0][1];
    expect(firstCallParams).toContain('aprobada');
    expect(result.data[0].estado).toBe('aprobada');
  });

  it('ignora estado inválido (no aparece en params de la query)', async () => {
    query
      .mockResolvedValueOnce({ rows: [SOL] })
      .mockResolvedValueOnce({ rows: [{ count: '1' }] });

    await getAll({ estado: 'inventado' });
    const firstCallParams = query.mock.calls[0][1];
    expect(firstCallParams).not.toContain('inventado');
  });

  it('respeta page y limit en la paginación', async () => {
    query
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ count: '30' }] });

    const result = await getAll({ page: '2', limit: '5' });
    expect(result.meta).toMatchObject({ page: 2, limit: 5, total: 30 });
    expect(result.meta.hasNext).toBe(true);
    expect(result.meta.hasPrev).toBe(true);
  });

  it('retorna data vacía cuando no hay solicitudes', async () => {
    query
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ count: '0' }] });

    const result = await getAll({});
    expect(result.data).toHaveLength(0);
    expect(result.meta.total).toBe(0);
  });

  it('filtra por tipo válido cuando se provee', async () => {
    query
      .mockResolvedValueOnce({ rows: [{ ...SOL, tipo: 'uso-suelo' }] })
      .mockResolvedValueOnce({ rows: [{ count: '1' }] });

    const result = await getAll({ tipo: 'uso-suelo' });
    const firstCallParams = query.mock.calls[0][1];
    expect(firstCallParams).toContain('uso-suelo');
    expect(result.data[0].tipo).toBe('uso-suelo');
  });

  it('lanza 400 para tipo inválido (no en whitelist)', async () => {
    await expect(getAll({ tipo: 'agua' })).rejects.toMatchObject({ status: 400 });
  });
});

// ─── getMine() ────────────────────────────────────────────────────────────────
describe('solicitudes.service → getMine()', () => {
  beforeEach(() => vi.clearAllMocks());

  it('retorna las solicitudes del usuario autenticado', async () => {
    query
      .mockResolvedValueOnce({ rows: [SOL] })
      .mockResolvedValueOnce({ rows: [{ count: '1' }] });

    const result = await getMine('usr-uuid-1', {});
    expect(query.mock.calls[0][1][0]).toBe('usr-uuid-1');
    expect(result.data).toHaveLength(1);
    expect(result.meta.total).toBe(1);
  });

  it('retorna lista vacía si el usuario no tiene solicitudes', async () => {
    query
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ count: '0' }] });

    const result = await getMine('usr-otro', {});
    expect(result.data).toHaveLength(0);
    expect(result.meta.total).toBe(0);
  });

  it('respeta page y limit del usuario', async () => {
    query
      .mockResolvedValueOnce({ rows: [SOL, { ...SOL, id: 'sol-2' }] })
      .mockResolvedValueOnce({ rows: [{ count: '2' }] });

    const result = await getMine('usr-uuid-1', { page: '1', limit: '2' });
    expect(result.meta.limit).toBe(2);
    expect(result.data).toHaveLength(2);
  });
});

// ─── create() ─────────────────────────────────────────────────────────────────
describe('solicitudes.service → create()', () => {
  beforeEach(() => vi.clearAllMocks());

  it('inserta y retorna la solicitud creada', async () => {
    query
      .mockResolvedValueOnce({ rows: [{ count: '0' }] }) // rate limit check
      .mockResolvedValueOnce({ rows: [SOL] });            // INSERT

    const result = await create(
      { tipo: 'uso-suelo', descripcion: 'Solicito acceso a datos' },
      'usr-uuid-1'
    );
    expect(result.id).toBe('sol-uuid-1');
    expect(query).toHaveBeenCalledTimes(2);
    const params = query.mock.calls[1][1]; // 2nd call = INSERT
    expect(params).toContain('uso-suelo');
    expect(params).toContain('usr-uuid-1');
  });

  it('pasa descripción aunque sea undefined (BD puede manejarla como null)', async () => {
    query
      .mockResolvedValueOnce({ rows: [{ count: '0' }] })
      .mockResolvedValueOnce({ rows: [{ ...SOL, descripcion: null }] });
    const result = await create({ tipo: 'biodiversidad', descripcion: undefined }, 'usr-2');
    expect(result).toBeDefined();
  });

  it('el SQL de INSERT hace RETURNING *', async () => {
    query
      .mockResolvedValueOnce({ rows: [{ count: '0' }] })
      .mockResolvedValueOnce({ rows: [SOL] });
    await create({ tipo: 'agua', descripcion: 'Test' }, 'usr-3');
    const sql = query.mock.calls[1][0]; // 2nd call = INSERT
    expect(sql).toMatch(/RETURNING/i);
  });

  it('lanza 429 si el usuario supera 5 solicitudes en 24 horas', async () => {
    query.mockResolvedValueOnce({ rows: [{ count: '5' }] });
    await expect(
      create({ tipo: 'uso-suelo', descripcion: 'Solicitud extra' }, 'usr-spam')
    ).rejects.toMatchObject({ status: 429 });
    expect(query).toHaveBeenCalledOnce(); // solo el rate limit check, nunca el INSERT
  });
});

// ─── updateEstado() ───────────────────────────────────────────────────────────
describe('solicitudes.service → updateEstado()', () => {
  beforeEach(() => vi.clearAllMocks());

  it('actualiza a "aprobada" y retorna el registro actualizado', async () => {
    query
      .mockResolvedValueOnce({ rows: [{ estado: 'pendiente' }] })             // SELECT estado actual
      .mockResolvedValueOnce({ rows: [{ ...SOL, estado: 'aprobada' }] });     // UPDATE

    const result = await updateEstado('sol-uuid-1', 'aprobada', 'Todo correcto', 'admin-uuid');
    expect(result.estado).toBe('aprobada');
  });

  it('actualiza a "rechazada" con nota_admin', async () => {
    query
      .mockResolvedValueOnce({ rows: [{ estado: 'pendiente' }] })
      .mockResolvedValueOnce({
        rows: [{ ...SOL, estado: 'rechazada', nota_admin: 'Datos incompletos' }],
      });
    const result = await updateEstado('sol-uuid-1', 'rechazada', 'Datos incompletos', 'admin-uuid');
    expect(result.estado).toBe('rechazada');
    expect(result.nota_admin).toBe('Datos incompletos');
  });

  it('actualiza a "en_revision"', async () => {
    query
      .mockResolvedValueOnce({ rows: [{ estado: 'pendiente' }] })
      .mockResolvedValueOnce({ rows: [{ ...SOL, estado: 'en_revision' }] });
    const result = await updateEstado('sol-uuid-1', 'en_revision', null, 'admin-uuid');
    expect(result.estado).toBe('en_revision');
  });

  it('lanza 400 si el estado es inválido y no llega a ejecutar query', async () => {
    await expect(
      updateEstado('sol-uuid-1', 'estado_inventado', null, 'admin-uuid')
    ).rejects.toMatchObject({ status: 400, message: 'Estado inválido' });
    expect(query).not.toHaveBeenCalled();
  });

  it('lanza 404 si la solicitud no existe (rows vacío)', async () => {
    query.mockResolvedValueOnce({ rows: [] });
    await expect(
      updateEstado('no-existe', 'pendiente', null, 'admin-uuid')
    ).rejects.toMatchObject({ status: 404 });
  });

  it('lanza 422 si la transición de estado no es válida', async () => {
    query.mockResolvedValueOnce({ rows: [{ estado: 'resuelta' }] }); // estado final
    await expect(
      updateEstado('sol-uuid-1', 'pendiente', null, 'admin-uuid')
    ).rejects.toMatchObject({ status: 422 });
  });

  it('pasa nota como null cuando se omite', async () => {
    query
      .mockResolvedValueOnce({ rows: [{ estado: 'pendiente' }] })
      .mockResolvedValueOnce({ rows: [SOL] });
    await updateEstado('sol-uuid-1', 'en_revision', undefined, 'admin-uuid');
    const params = query.mock.calls[1][1]; // 2nd call = UPDATE
    expect(params[1]).toBeNull();
  });

  it('incluye el estado leído como guarda CAS en el UPDATE (WHERE ... AND estado=$5)', async () => {
    query
      .mockResolvedValueOnce({ rows: [{ estado: 'pendiente' }] })
      .mockResolvedValueOnce({ rowCount: 1, rows: [{ ...SOL, estado: 'aprobada' }] });

    const result = await updateEstado('sol-uuid-1', 'aprobada', 'ok', 'admin-uuid');

    const [sql, params] = query.mock.calls[1];
    expect(sql).toMatch(/AND estado=\$5/);
    expect(params[4]).toBe('pendiente'); // estadoActual leído en el SELECT
    expect(result.estado).toBe('aprobada');
  });

  it('lanza 409 cuando el estado cambió entre el SELECT y el UPDATE (carrera concurrente)', async () => {
    // Simula dos requests concurrentes actualizando la misma solicitud "pendiente":
    // ambas leen el mismo estado, pero el UPDATE de la primera ya lo cambió antes
    // de que el CAS de la segunda se ejecute → rowCount 0 en la segunda.
    query
      .mockResolvedValueOnce({ rows: [{ estado: 'pendiente' }] }) // SELECT (ambas lo ven igual)
      .mockResolvedValueOnce({ rowCount: 0, rows: [] });          // UPDATE pierde la carrera

    await expect(
      updateEstado('sol-uuid-1', 'rechazada', 'Datos incompletos', 'admin-uuid-2')
    ).rejects.toMatchObject({ status: 409 });
  });
});

// ─── responder() ──────────────────────────────────────────────────────────────
describe('solicitudes.service → responder()', () => {
  beforeEach(() => vi.clearAllMocks());

  it('marca como resuelta y persiste la respuesta', async () => {
    query
      .mockResolvedValueOnce({ rows: [{ estado: 'aprobada' }] })              // SELECT estado
      .mockResolvedValueOnce({
        rows: [{ ...SOL, estado: 'resuelta', nota_admin: 'Acceso concedido' }],
      });
    const result = await responder('sol-uuid-1', 'Acceso concedido', 'admin-uuid');
    expect(result.estado).toBe('resuelta');
    expect(result.nota_admin).toBe('Acceso concedido');
  });

  it('incluye respuesta y adminId en los params del UPDATE', async () => {
    query
      .mockResolvedValueOnce({ rows: [{ estado: 'en_revision' }] })
      .mockResolvedValueOnce({ rows: [{ ...SOL, estado: 'resuelta' }] });
    await responder('sol-uuid-1', 'Respuesta al solicitante', 'admin-uuid');
    const params = query.mock.calls[1][1]; // 2nd call = UPDATE
    expect(params[0]).toBe('Respuesta al solicitante');
    expect(params[1]).toBe('admin-uuid');
    expect(params[2]).toBe('sol-uuid-1');
  });

  it('lanza 422 si la solicitud ya está resuelta', async () => {
    query.mockResolvedValueOnce({ rows: [{ estado: 'resuelta' }] });
    await expect(
      responder('sol-uuid-1', 'Ya resuelta', 'admin-uuid')
    ).rejects.toMatchObject({ status: 422 });
  });

  it('lanza 404 si la solicitud no existe', async () => {
    query.mockResolvedValueOnce({ rows: [] });
    await expect(
      responder('no-existe', 'respuesta', 'admin-uuid')
    ).rejects.toMatchObject({ status: 404 });
  });

  it('incluye el estado leído como guarda CAS en el UPDATE (WHERE ... AND estado=$4)', async () => {
    query
      .mockResolvedValueOnce({ rows: [{ estado: 'aprobada' }] })
      .mockResolvedValueOnce({ rowCount: 1, rows: [{ ...SOL, estado: 'resuelta' }] });

    const result = await responder('sol-uuid-1', 'Acceso concedido', 'admin-uuid');

    const [sql, params] = query.mock.calls[1];
    expect(sql).toMatch(/AND estado=\$4/);
    expect(params[3]).toBe('aprobada');
    expect(result.estado).toBe('resuelta');
  });

  it('lanza 409 cuando el estado cambió entre el SELECT y el UPDATE (carrera concurrente)', async () => {
    // Dos admins responden la misma solicitud "aprobada" casi simultáneamente:
    // el primero gana la carrera y la marca resuelta; el segundo debe recibir
    // 409 en vez de sobrescribir la respuesta ya persistida.
    query
      .mockResolvedValueOnce({ rows: [{ estado: 'aprobada' }] })
      .mockResolvedValueOnce({ rowCount: 0, rows: [] });

    await expect(
      responder('sol-uuid-1', 'Respuesta duplicada', 'admin-uuid-2')
    ).rejects.toMatchObject({ status: 409 });
  });
});


// ─── getById() ─────────────────────────────────────────────────────────────

import { getById, getArchivos, removeArchivo } from '../src/modules/solicitudes/solicitudes.service.js';

describe('solicitudes.service → getById()', () => {
  beforeEach(() => vi.clearAllMocks());

  it('admin puede ver cualquier solicitud (params solo tienen el id)', async () => {
    query.mockResolvedValueOnce({ rows: [{ ...SOL, solicitante: 'Juan' }] });
    const result = await getById(SOL.id, 'other-user', true);
    const params = query.mock.calls[0][1];
    expect(params).toHaveLength(1);
    expect(result.id).toBe(SOL.id);
  });

  it('usuario normal: params incluyen userId para filtrar', async () => {
    query.mockResolvedValueOnce({ rows: [{ ...SOL, solicitante: 'Juan' }] });
    const result = await getById(SOL.id, SOL.usuario_id, false);
    const params = query.mock.calls[0][1];
    expect(params).toHaveLength(2);
    expect(result).toBeDefined();
  });

  it('lanza 404 si la solicitud no existe', async () => {
    query.mockResolvedValueOnce({ rows: [] });
    await expect(getById('no-existe', 'u1', false)).rejects.toMatchObject({ status: 404 });
  });
});

describe('solicitudes.service → getArchivos()', () => {
  beforeEach(() => vi.clearAllMocks());

  it('admin ve todos los archivos (2 queries: solicitud + archivos)', async () => {
    const archivos = [{ id: 'a1', nombre: 'doc.pdf' }];
    query.mockResolvedValueOnce({ rows: [{ id: SOL.id }] }); // SELECT solicitud
    query.mockResolvedValueOnce({ rows: archivos }); // SELECT archivos
    const result = await getArchivos(SOL.id, 'u1', true);
    expect(result).toEqual(archivos);
  });

  it('lanza 404 si la solicitud no existe', async () => {
    query.mockResolvedValueOnce({ rows: [] }); // solicitud no encontrada
    await expect(getArchivos('no-existe', 'u1', false)).rejects.toMatchObject({ status: 404 });
  });
});

// ─── addArchivo() — branches de validación y acceso ───────────────────────

vi.mock('../src/middlewares/fileGuard.js', () => ({
  validateFile: vi.fn().mockReturnValue({ valid: true, sanitizedExt: 'pdf' }),
  sha256: vi.fn().mockReturnValue('abc123hash'),
}));
vi.mock('../src/utils/dataCustody.js', () => ({
  registrarScanArchivo: vi.fn().mockResolvedValue(undefined),
  registrarCustodia: vi.fn(), registrarDescarga: vi.fn(), ACCION: {},
}));

import { addArchivo } from '../src/modules/solicitudes/solicitudes.service.js';
import { validateFile } from '../src/middlewares/fileGuard.js';
import { uploadFile, deleteFileByUrl } from '../src/config/r2.js';

const MOCK_FILE = {
  originalname: 'doc.pdf',
  mimetype: 'application/pdf',
  buffer: Buffer.from('test content'),
  size: 1024,
};

describe('solicitudes.service → addArchivo()', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    uploadFile.mockResolvedValue('https://files.test.local/sol/doc.pdf');
    deleteFileByUrl.mockResolvedValue(undefined);
    validateFile.mockReturnValue({ valid: true, sanitizedExt: 'pdf' });
  });

  it('lanza 404 si la solicitud no existe', async () => {
    query.mockResolvedValueOnce({ rows: [] }); // SELECT solicitud
    await expect(addArchivo('no-existe', MOCK_FILE, 'u1', false, '::1'))
      .rejects.toMatchObject({ status: 404 });
  });

  it('lanza 422 si la solicitud está resuelta y el usuario no es admin', async () => {
    query.mockResolvedValueOnce({ rows: [{ id: 'sol-1', estado: 'resuelta' }] });
    await expect(addArchivo('sol-1', MOCK_FILE, 'u1', false, '::1'))
      .rejects.toMatchObject({ status: 422 });
  });

  it('admin puede adjuntar archivo a solicitud resuelta', async () => {
    query
      .mockResolvedValueOnce({ rows: [{ id: 'sol-1', estado: 'resuelta' }] }) // solicitud
      .mockResolvedValueOnce({ rows: [{ count: '0' }] }) // count archivos
      .mockResolvedValueOnce({ rows: [{ id: 'a1', nombre: 'doc.pdf', tamano_bytes: 1024, mime_type: 'application/pdf', creado_en: new Date() }] }); // INSERT
    const result = await addArchivo('sol-1', MOCK_FILE, 'admin1', true, '::1');
    expect(result).toBeDefined();
    expect(uploadFile).toHaveBeenCalledOnce();
  });

  it('lanza 422 si se alcanza el límite de 5 archivos', async () => {
    query
      .mockResolvedValueOnce({ rows: [{ id: 'sol-1', estado: 'pendiente' }] })
      .mockResolvedValueOnce({ rows: [{ count: '5' }] }); // límite alcanzado
    await expect(addArchivo('sol-1', MOCK_FILE, 'u1', false, '::1'))
      .rejects.toMatchObject({ status: 422 });
  });

  it('lanza 422 si el tipo de archivo no es válido', async () => {
    validateFile.mockReturnValue({ valid: false, error: 'Tipo no permitido' });
    query
      .mockResolvedValueOnce({ rows: [{ id: 'sol-1', estado: 'pendiente' }] })
      .mockResolvedValueOnce({ rows: [{ count: '0' }] });
    await expect(addArchivo('sol-1', { ...MOCK_FILE, mimetype: 'text/html' }, 'u1', false, '::1'))
      .rejects.toMatchObject({ status: 422 });
  });

  it('inserta el archivo y lo sube a R2 exitosamente', async () => {
    query
      .mockResolvedValueOnce({ rows: [{ id: 'sol-1', estado: 'pendiente' }] })
      .mockResolvedValueOnce({ rows: [{ count: '0' }] })
      .mockResolvedValueOnce({ rows: [{ id: 'a1', nombre: 'doc.pdf', tamano_bytes: 1024, mime_type: 'application/pdf', creado_en: new Date() }] });
    const result = await addArchivo('sol-1', MOCK_FILE, 'u1', false, '::1');
    expect(uploadFile).toHaveBeenCalledOnce();
    expect(result.nombre).toBe('doc.pdf');
  });
});

// ─── getArchivoPresignedUrl() ─────────────────────────────────────────────────

import { getArchivoPresignedUrl } from '../src/modules/solicitudes/solicitudes.service.js';
import { extractKey, getPresignedUrl } from '../src/config/r2.js';

describe('solicitudes.service → getArchivoPresignedUrl()', () => {
  beforeEach(() => vi.clearAllMocks());

  it('lanza 404 si la solicitud no existe', async () => {
    query.mockResolvedValueOnce({ rows: [] });
    await expect(getArchivoPresignedUrl('s1', 'a1', 'u1', false))
      .rejects.toMatchObject({ status: 404 });
  });

  it('lanza 404 si el archivo no existe', async () => {
    query
      .mockResolvedValueOnce({ rows: [{ id: 's1' }] })
      .mockResolvedValueOnce({ rows: [] });
    await expect(getArchivoPresignedUrl('s1', 'a1', 'u1', false))
      .rejects.toMatchObject({ status: 404 });
  });

  it('lanza 500 si extractKey retorna null', async () => {
    query
      .mockResolvedValueOnce({ rows: [{ id: 's1' }] })
      .mockResolvedValueOnce({ rows: [{ url: 'https://bad-url', nombre: 'doc.pdf' }] });
    extractKey.mockReturnValueOnce(null);
    await expect(getArchivoPresignedUrl('s1', 'a1', 'u1', false))
      .rejects.toMatchObject({ status: 500 });
  });

  it('retorna url y nombre en path de admin (isAdmin=true, sin userId en query)', async () => {
    query
      .mockResolvedValueOnce({ rows: [{ id: 's1' }] })
      .mockResolvedValueOnce({ rows: [{ url: 'https://files.test/key', nombre: 'mapa.pdf' }] });
    extractKey.mockReturnValueOnce('key');
    getPresignedUrl.mockResolvedValueOnce('https://presigned.test/key');

    const result = await getArchivoPresignedUrl('s1', 'a1', 'u1', true);
    const firstParams = query.mock.calls[0][1];
    expect(firstParams).toHaveLength(1);
    expect(result).toEqual({ url: 'https://presigned.test/key', nombre: 'mapa.pdf' });
  });

  it('retorna url y nombre en path de usuario normal (isAdmin=false, userId en query)', async () => {
    query
      .mockResolvedValueOnce({ rows: [{ id: 's1' }] })
      .mockResolvedValueOnce({ rows: [{ url: 'https://files.test/key2', nombre: 'doc.pdf' }] });
    extractKey.mockReturnValueOnce('key2');
    getPresignedUrl.mockResolvedValueOnce('https://presigned.test/key2');

    const result = await getArchivoPresignedUrl('s1', 'a1', 'u1', false);
    const firstParams = query.mock.calls[0][1];
    expect(firstParams).toHaveLength(2);
    expect(result.url).toBe('https://presigned.test/key2');
  });
});
