import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';

vi.mock('../src/modules/categorias/categorias.service.js', () => ({
  getAll:          vi.fn(),
  upsert:          vi.fn(),
  updateThumbnail: vi.fn(),
  rename:          vi.fn(),
  remove:          vi.fn(),
  updateModulos:   vi.fn(),
}));

// query() aquí solo lo consume requireModulo (categorias.service.js está
// mockeado arriba) — por defecto el admin_sig de prueba tiene el módulo habilitado.
vi.mock('../src/config/database.js', () => ({
  query:     vi.fn().mockResolvedValue({ rows: [{ puede_ver: true, puede_editar: true }] }),
  getClient: vi.fn(),
}));

vi.mock('../src/config/r2.js', () => ({
  uploadFile:      vi.fn().mockResolvedValue('https://files.test.local/thumb.jpg'),
  deleteFile:      vi.fn().mockResolvedValue(undefined),
  extractKey:      vi.fn((url) => url?.split('/').pop() ?? null),
  isPublicUrl:     vi.fn(() => true),
  getPresignedUrl: vi.fn(),
}));

vi.mock('../src/utils/auditLog.js', () => ({
  registrarAuditoria: vi.fn(),
}));

// invalidateCache rechaza a propósito — ejercita el .catch(() => {}) silencioso
// que envuelve cada llamada en el controller (no debe interrumpir la respuesta).
vi.mock('../src/middlewares/cache.js', () => ({
  invalidateCache: vi.fn().mockRejectedValue(new Error('redis no disponible')),
  cacheMiddleware: () => (_req, _res, next) => next(),
  getRedisClient:  vi.fn(() => null),
}));

import * as catService from '../src/modules/categorias/categorias.service.js';
import { index, create, rename, destroy, upsertThumbnail, updateModulos } from '../src/modules/categorias/categorias.controller.js';

// ── Helper: mock Express req/res/next ──────────────────────────────────────

function mockRes() {
    // end necesario para rutas que devuelven 204 sin cuerpo (DELETE categoría)
  const res = {
    status: vi.fn().mockReturnThis(),
    json:   vi.fn().mockReturnThis(),
    end:    vi.fn(),
  };
  return res;
}

const mockNext = vi.fn();

const CAT = { nombre: 'Biodiversidad', thumbnail_url: 'https://files.test.local/cat.jpg' };

// ── index() ────────────────────────────────────────────────────────────────

describe('categorias.controller → index()', () => {
  beforeEach(() => vi.clearAllMocks());

  it('responde con la lista de categorías del servicio', async () => {
    catService.getAll.mockResolvedValue([CAT]);
    const res = mockRes();
    await index({}, res, mockNext);
    expect(catService.getAll).toHaveBeenCalledOnce();
    expect(res.json).toHaveBeenCalledWith([CAT]);
    expect(mockNext).not.toHaveBeenCalled();
  });

  it('llama next(err) cuando el servicio lanza', async () => {
    const err = new Error('DB failure');
    catService.getAll.mockRejectedValue(err);
    const res = mockRes();
    await index({}, res, mockNext);
    expect(mockNext).toHaveBeenCalledWith(err);
    expect(res.json).not.toHaveBeenCalled();
  });
});

// ── create() ──────────────────────────────────────────────────────────────

describe('categorias.controller → create()', () => {
  beforeEach(() => vi.clearAllMocks());

  it('retorna 400 cuando nombre está vacío', async () => {
    const req = { body: { nombre: '   ', modulos: ['documentos'] }, user: { id: 'u1', email: 'a@b.com' }, ip: '::1' };
    const res = mockRes();
    await create(req, res, mockNext);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ error: expect.any(String) }));
    expect(catService.upsert).not.toHaveBeenCalled();
  });

  it('retorna 400 cuando nombre está ausente', async () => {
    const req = { body: { modulos: ['documentos'] }, user: { id: 'u1', email: 'a@b.com' }, ip: '::1' };
    const res = mockRes();
    await create(req, res, mockNext);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('retorna 400 cuando modulos está ausente', async () => {
    const req = { body: { nombre: 'Biodiversidad' }, user: { id: 'u1', email: 'a@b.com' }, ip: '::1' };
    const res = mockRes();
    await create(req, res, mockNext);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(catService.upsert).not.toHaveBeenCalled();
  });

  it('retorna 400 cuando modulos es un arreglo vacío', async () => {
    const req = { body: { nombre: 'Biodiversidad', modulos: [] }, user: { id: 'u1', email: 'a@b.com' }, ip: '::1' };
    const res = mockRes();
    await create(req, res, mockNext);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(catService.upsert).not.toHaveBeenCalled();
  });

  it('retorna 400 cuando modulos incluye un valor no reconocido', async () => {
    const req = { body: { nombre: 'Biodiversidad', modulos: ['usuarios'] }, user: { id: 'u1', email: 'a@b.com' }, ip: '::1' };
    const res = mockRes();
    await create(req, res, mockNext);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(catService.upsert).not.toHaveBeenCalled();
  });

  it('crea categoría y responde 201 con resultado del servicio', async () => {
    catService.upsert.mockResolvedValue(CAT);
    const req = { body: { nombre: 'Biodiversidad', modulos: ['documentos', 'mapas'] }, user: { id: 'u1', email: 'a@b.com' }, ip: '::1' };
    const res = mockRes();
    await create(req, res, mockNext);
    expect(catService.upsert).toHaveBeenCalledWith('Biodiversidad', null, ['documentos', 'mapas']);
    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json).toHaveBeenCalledWith(CAT);
  });

  it('llama next(err) cuando el servicio lanza', async () => {
    const err = new Error('upsert fail');
    catService.upsert.mockRejectedValue(err);
    const req = { body: { nombre: 'Flora', modulos: ['documentos'] }, user: { id: 'u1', email: 'a@b.com' }, ip: '::1' };
    const res = mockRes();
    await create(req, res, mockNext);
    expect(mockNext).toHaveBeenCalledWith(err);
  });
});

// ── updateModulos() ───────────────────────────────────────────────────────

describe('categorias.controller → updateModulos()', () => {
  beforeEach(() => vi.clearAllMocks());

  it('retorna 400 cuando modulos es inválido', async () => {
    const req = { params: { nombre: 'Biodiversidad' }, body: { modulos: [] }, user: { id: 'u1', email: 'a@b.com' }, ip: '::1' };
    const res = mockRes();
    await updateModulos(req, res, mockNext);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(catService.updateModulos).not.toHaveBeenCalled();
  });

  it('actualiza los módulos y responde con el resultado', async () => {
    const updated = { ...CAT, modulos: ['geovisores'] };
    catService.updateModulos.mockResolvedValue(updated);
    const req = { params: { nombre: 'Biodiversidad' }, body: { modulos: ['geovisores'] }, user: { id: 'u1', email: 'a@b.com' }, ip: '::1' };
    const res = mockRes();
    await updateModulos(req, res, mockNext);
    expect(catService.updateModulos).toHaveBeenCalledWith('Biodiversidad', ['geovisores']);
    expect(res.json).toHaveBeenCalledWith(updated);
  });

  it('decodifica el nombre del parámetro URL', async () => {
    catService.updateModulos.mockResolvedValue(CAT);
    const req = { params: { nombre: 'Biodiversidad%20Marina' }, body: { modulos: ['mapas'] }, user: { id: 'u1', email: 'a@b.com' }, ip: '::1' };
    const res = mockRes();
    await updateModulos(req, res, mockNext);
    expect(catService.updateModulos).toHaveBeenCalledWith('Biodiversidad Marina', ['mapas']);
  });

  it('llama next(err) cuando el servicio lanza', async () => {
    const err = Object.assign(new Error('no found'), { status: 404 });
    catService.updateModulos.mockRejectedValue(err);
    const req = { params: { nombre: 'NoExiste' }, body: { modulos: ['mapas'] }, user: { id: 'u1', email: 'a@b.com' }, ip: '::1' };
    const res = mockRes();
    await updateModulos(req, res, mockNext);
    expect(mockNext).toHaveBeenCalledWith(err);
  });
});

// ── rename() ──────────────────────────────────────────────────────────────

describe('categorias.controller → rename()', () => {
  beforeEach(() => vi.clearAllMocks());

  it('retorna 400 cuando nuevoNombre está vacío', async () => {
    const req = { params: { nombre: 'Biodiversidad' }, body: { nuevoNombre: '  ' }, user: { id: 'u1', email: 'a@b.com' }, ip: '::1' };
    const res = mockRes();
    await rename(req, res, mockNext);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(catService.rename).not.toHaveBeenCalled();
  });

  it('decodifica el nombre actual y llama al servicio con ambos nombres', async () => {
    catService.rename.mockResolvedValue({ nombre: 'Fauna' });
    const req = { params: { nombre: 'Biodiversidad%20Marina' }, body: { nuevoNombre: 'Fauna' }, user: { id: 'u1', email: 'a@b.com' }, ip: '::1' };
    const res = mockRes();
    await rename(req, res, mockNext);
    expect(catService.rename).toHaveBeenCalledWith('Biodiversidad Marina', 'Fauna');
    expect(res.json).toHaveBeenCalledWith({ nombre: 'Fauna' });
  });

  it('llama next(err) cuando el servicio lanza (ej. 409 por nombre duplicado)', async () => {
    const err = Object.assign(new Error('duplicado'), { status: 409 });
    catService.rename.mockRejectedValue(err);
    const req = { params: { nombre: 'Flora' }, body: { nuevoNombre: 'Fauna' }, user: { id: 'u1', email: 'a@b.com' }, ip: '::1' };
    const res = mockRes();
    await rename(req, res, mockNext);
    expect(mockNext).toHaveBeenCalledWith(err);
  });
});

// ── destroy() ─────────────────────────────────────────────────────────────

describe('categorias.controller → destroy()', () => {
  beforeEach(() => vi.clearAllMocks());

  it('elimina la categoría y responde 204 sin cuerpo', async () => {
    catService.remove.mockResolvedValue(undefined);
    const req = { params: { nombre: 'Biodiversidad' }, user: { id: 'u1', email: 'a@b.com' }, ip: '::1' };
    const res = mockRes();
    await destroy(req, res, mockNext);
    expect(catService.remove).toHaveBeenCalledWith('Biodiversidad');
    expect(res.status).toHaveBeenCalledWith(204);
    expect(res.end).toHaveBeenCalled();
  });

  it('decodifica el nombre del parámetro URL', async () => {
    catService.remove.mockResolvedValue(undefined);
    const req = { params: { nombre: 'Biodiversidad%20Marina' }, user: { id: 'u1', email: 'a@b.com' }, ip: '::1' };
    const res = mockRes();
    await destroy(req, res, mockNext);
    expect(catService.remove).toHaveBeenCalledWith('Biodiversidad Marina');
  });

  it('llama next(err) cuando el servicio lanza', async () => {
    const err = Object.assign(new Error('no found'), { status: 404 });
    catService.remove.mockRejectedValue(err);
    const req = { params: { nombre: 'NoExiste' }, user: { id: 'u1', email: 'a@b.com' }, ip: '::1' };
    const res = mockRes();
    await destroy(req, res, mockNext);
    expect(mockNext).toHaveBeenCalledWith(err);
  });
});

// ── upsertThumbnail() ─────────────────────────────────────────────────────

describe('categorias.controller → upsertThumbnail()', () => {
  beforeEach(() => vi.clearAllMocks());

  it('actualiza el thumbnail y responde con el resultado', async () => {
    const updated = { ...CAT, thumbnail_url: 'https://files.test.local/new.jpg' };
    catService.updateThumbnail.mockResolvedValue(updated);
    const req = {
      params: { nombre: 'Biodiversidad' },
      body: { thumbnail_url: 'https://files.test.local/new.jpg' },
      user: { id: 'u1', email: 'a@b.com' },
      ip: '::1',
    };
    const res = mockRes();
    await upsertThumbnail(req, res, mockNext);
    expect(catService.updateThumbnail).toHaveBeenCalledWith('Biodiversidad', 'https://files.test.local/new.jpg');
    expect(res.json).toHaveBeenCalledWith(updated);
  });

  it('pasa null cuando thumbnail_url no está en el body', async () => {
    catService.updateThumbnail.mockResolvedValue({ ...CAT, thumbnail_url: null });
    const req = {
      params: { nombre: 'Biodiversidad' },
      body: {},
      user: { id: 'u1', email: 'a@b.com' },
      ip: '::1',
    };
    const res = mockRes();
    await upsertThumbnail(req, res, mockNext);
    expect(catService.updateThumbnail).toHaveBeenCalledWith('Biodiversidad', null);
  });

  it('llama next(err) cuando el servicio lanza', async () => {
    const err = new Error('thumbnail fail');
    catService.updateThumbnail.mockRejectedValue(err);
    const req = {
      params: { nombre: 'X' },
      body: {},
      user: { id: 'u1', email: 'a@b.com' },
      ip: '::1',
    };
    const res = mockRes();
    await upsertThumbnail(req, res, mockNext);
    expect(mockNext).toHaveBeenCalledWith(err);
  });
});

// ── Integration via supertest (auth + routing) ─────────────────────────────

describe('Categorias routes — auth guards via supertest', () => {
  let app;

  beforeEach(async () => {
    vi.clearAllMocks();
    app = (await import('../src/app.js')).default;
  });

  const adminToken = jwt.sign(
    { id: 'uuid-admin', email: 'admin@iiap.org.co', rol: 'admin_sig' },
    process.env.JWT_SECRET,
  );

  it('POST /api/categorias → 401 sin token', async () => {
    const res = await request(app).post('/api/categorias').send({ nombre: 'Flora' });
    expect(res.status).toBe(401);
  });

  it('DELETE /api/categorias/:nombre → 401 sin token', async () => {
    const res = await request(app).delete('/api/categorias/Flora');
    expect(res.status).toBe(401);
  });

  it('PATCH /api/categorias/:nombre → 401 sin token', async () => {
    const res = await request(app).patch('/api/categorias/Flora').send({ nuevoNombre: 'Fauna' });
    expect(res.status).toBe(401);
  });

  it('PATCH /api/categorias/:nombre → 200 con token admin_sig y módulo habilitado', async () => {
    catService.rename.mockResolvedValue({ nombre: 'Fauna' });
    const res = await request(app)
      .patch('/api/categorias/Flora')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ nuevoNombre: 'Fauna' });
    expect(res.status).toBe(200);
    expect(catService.rename).toHaveBeenCalledWith('Flora', 'Fauna');
  });

  it('PATCH /api/categorias/:nombre/modulos → 401 sin token', async () => {
    const res = await request(app).patch('/api/categorias/Flora/modulos').send({ modulos: ['mapas'] });
    expect(res.status).toBe(401);
  });

  it('PATCH /api/categorias/:nombre/modulos → 200 con token admin_sig y módulo habilitado', async () => {
    catService.updateModulos.mockResolvedValue({ nombre: 'Flora', modulos: ['mapas'] });
    const res = await request(app)
      .patch('/api/categorias/Flora/modulos')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ modulos: ['mapas'] });
    expect(res.status).toBe(200);
    expect(catService.updateModulos).toHaveBeenCalledWith('Flora', ['mapas']);
  });
});
