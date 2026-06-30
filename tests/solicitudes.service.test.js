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
  uploadFile:      vi.fn(),
  deleteFile:      vi.fn(),
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
    query.mockResolvedValueOnce({ rows: [SOL] });

    const result = await create(
      { tipo: 'uso-suelo', descripcion: 'Solicito acceso a datos' },
      'usr-uuid-1'
    );
    expect(result.id).toBe('sol-uuid-1');
    expect(query).toHaveBeenCalledOnce();
    const params = query.mock.calls[0][1];
    expect(params).toContain('uso-suelo');
    expect(params).toContain('usr-uuid-1');
  });

  it('pasa descripción aunque sea undefined (BD puede manejarla como null)', async () => {
    query.mockResolvedValueOnce({ rows: [{ ...SOL, descripcion: null }] });
    const result = await create({ tipo: 'biodiversidad', descripcion: undefined }, 'usr-2');
    expect(result).toBeDefined();
    expect(query).toHaveBeenCalledOnce();
  });

  it('el SQL de INSERT hace RETURNING *', async () => {
    query.mockResolvedValueOnce({ rows: [SOL] });
    await create({ tipo: 'agua', descripcion: 'Test' }, 'usr-3');
    const sql = query.mock.calls[0][0];
    expect(sql).toMatch(/RETURNING/i);
  });
});

// ─── updateEstado() ───────────────────────────────────────────────────────────
describe('solicitudes.service → updateEstado()', () => {
  beforeEach(() => vi.clearAllMocks());

  it('actualiza a "aprobada" y retorna el registro actualizado', async () => {
    query.mockResolvedValueOnce({ rows: [{ ...SOL, estado: 'aprobada' }] });

    const result = await updateEstado('sol-uuid-1', 'aprobada', 'Todo correcto', 'admin-uuid');
    expect(result.estado).toBe('aprobada');
  });

  it('actualiza a "rechazada" con nota_admin', async () => {
    query.mockResolvedValueOnce({
      rows: [{ ...SOL, estado: 'rechazada', nota_admin: 'Datos incompletos' }],
    });
    const result = await updateEstado('sol-uuid-1', 'rechazada', 'Datos incompletos', 'admin-uuid');
    expect(result.estado).toBe('rechazada');
    expect(result.nota_admin).toBe('Datos incompletos');
  });

  it('actualiza a "en_revision"', async () => {
    query.mockResolvedValueOnce({ rows: [{ ...SOL, estado: 'en_revision' }] });
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

  it('pasa nota como null cuando se omite', async () => {
    query.mockResolvedValueOnce({ rows: [SOL] });
    await updateEstado('sol-uuid-1', 'en_revision', undefined, 'admin-uuid');
    const params = query.mock.calls[0][1];
    expect(params[1]).toBeNull();
  });
});

// ─── responder() ──────────────────────────────────────────────────────────────
describe('solicitudes.service → responder()', () => {
  beforeEach(() => vi.clearAllMocks());

  it('marca como resuelta y persiste la respuesta', async () => {
    query.mockResolvedValueOnce({
      rows: [{ ...SOL, estado: 'resuelta', nota_admin: 'Acceso concedido' }],
    });
    const result = await responder('sol-uuid-1', 'Acceso concedido', 'admin-uuid');
    expect(result.estado).toBe('resuelta');
    expect(result.nota_admin).toBe('Acceso concedido');
  });

  it('incluye respuesta y adminId en los params del UPDATE', async () => {
    query.mockResolvedValueOnce({ rows: [{ ...SOL, estado: 'resuelta' }] });
    await responder('sol-uuid-1', 'Respuesta al solicitante', 'admin-uuid');
    const params = query.mock.calls[0][1];
    expect(params[0]).toBe('Respuesta al solicitante');
    expect(params[1]).toBe('admin-uuid');
    expect(params[2]).toBe('sol-uuid-1');
  });

  it('lanza 404 si la solicitud no existe', async () => {
    query.mockResolvedValueOnce({ rows: [] });
    await expect(
      responder('no-existe', 'respuesta', 'admin-uuid')
    ).rejects.toMatchObject({ status: 404 });
  });
});

// ─── getById() ─────────────────────────────────────────────────────────────

import { getById, getArchivos, addArchivo, removeArchivo, getArchivoPresignedUrl } from '../src/modules/solicitudes/solicitudes.service.js';
import { isPublicUrl, extractKey, getPresignedUrl } from '../src/config/r2.js';

describe('solicitudes.service → getById()', () => {
  beforeEach(() => vi.clearAllMocks());

  it('admin puede ver cualquier solicitud (sin filtro usuario_id)', async () => {
    query.mockResolvedValueOnce({ rows: [{ ...SOL, solicitante: 'Juan' }] });
    const result = await getById(SOL.id, 'other-user', 'admin_sig');
    const sql = query.mock.calls[0][0];
    const params = query.mock.calls[0][1];
    expect(params).toHaveLength(1);
  });

  it('usuario normal solo ve sus propias solicitudes', async () => {
    query.mockResolvedValueOnce({ rows: [{ ...SOL, solicitante: 'Juan' }] });
    const result = await getById(SOL.id, SOL.usuario_id, 'investigador');
    const sql = query.mock.calls[0][0];
    expect(sql).toMatch(/usuario_id/);
    expect(result).toBeDefined();
  });

  it('lanza 404 si la solicitud no existe', async () => {
    query.mockResolvedValueOnce({ rows: [] });
    await expect(getById('no-existe', 'u1', 'investigador')).rejects.toMatchObject({ status: 404 });
  });
});

describe('solicitudes.service → getArchivos()', () => {
  beforeEach(() => vi.clearAllMocks());

  it('retorna los archivos de la solicitud', async () => {
    const archivos = [{ id: 'a1', nombre: 'doc.pdf' }];
    query.mockResolvedValueOnce({ rows: archivos });
    const result = await getArchivos(SOL.id);
    expect(result).toEqual(archivos);
  });

  it('retorna lista vacía si no hay archivos', async () => {
    query.mockResolvedValueOnce({ rows: [] });
    const result = await getArchivos(SOL.id);
    expect(result).toEqual([]);
  });
});

describe('solicitudes.service → addArchivo()', () => {
  beforeEach(() => vi.clearAllMocks());

  it('inserta el archivo y retorna el registro creado', async () => {
    const arch = { id: 'a1', nombre: 'doc.pdf', tamano_bytes: 1024, mime_type: 'application/pdf', creado_en: new Date() };
    query.mockResolvedValueOnce({ rows: [arch] });
    const result = await addArchivo(SOL.id, { nombre: 'doc.pdf', archivo_url: 'https://r2.local/doc.pdf', tamano_bytes: 1024, mime_type: 'application/pdf' }, 'u1');
    expect(result.nombre).toBe('doc.pdf');
  });
});

describe('solicitudes.service → removeArchivo()', () => {
  beforeEach(() => vi.clearAllMocks());

  it('elimina el archivo y retorna la url', async () => {
    query.mockResolvedValueOnce({ rows: [{ archivo_url: 'https://r2.local/doc.pdf' }] });
    const result = await removeArchivo(SOL.id, 'a1');
    expect(result.archivo_url).toContain('doc.pdf');
  });

  it('lanza 404 si el archivo no existe', async () => {
    query.mockResolvedValueOnce({ rows: [] });
    await expect(removeArchivo(SOL.id, 'no-existe')).rejects.toMatchObject({ status: 404 });
  });
});

describe('solicitudes.service → getArchivoPresignedUrl()', () => {
  beforeEach(() => vi.clearAllMocks());

  it('retorna la URL pública directamente si isPublicUrl=true', async () => {
    query.mockResolvedValueOnce({ rows: [{ archivo_url: 'https://files.test.local/doc.pdf' }] });
    isPublicUrl.mockReturnValueOnce(true);
    const result = await getArchivoPresignedUrl(SOL.id, 'a1');
    expect(result.url).toBe('https://files.test.local/doc.pdf');
    expect(getPresignedUrl).not.toHaveBeenCalled();
  });

  it('genera URL prefirmada para archivo privado', async () => {
    query.mockResolvedValueOnce({ rows: [{ archivo_url: 'https://private.r2.local/doc.pdf' }] });
    isPublicUrl.mockReturnValueOnce(false);
    extractKey.mockReturnValueOnce('doc.pdf');
    const result = await getArchivoPresignedUrl(SOL.id, 'a1');
    expect(getPresignedUrl).toHaveBeenCalledWith('doc.pdf', 120);
    expect(result.url).toBe('https://presigned.test.local/file');
  });

  it('lanza 404 si el archivo no existe', async () => {
    query.mockResolvedValueOnce({ rows: [] });
    await expect(getArchivoPresignedUrl(SOL.id, 'no-existe')).rejects.toMatchObject({ status: 404 });
  });

  it('lanza 500 si extractKey retorna null', async () => {
    query.mockResolvedValueOnce({ rows: [{ archivo_url: 'https://private.r2.local/doc.pdf' }] });
    isPublicUrl.mockReturnValueOnce(false);
    extractKey.mockReturnValueOnce(null);
    await expect(getArchivoPresignedUrl(SOL.id, 'a1')).rejects.toMatchObject({ status: 500 });
  });
});
