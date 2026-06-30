import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';

vi.mock('../src/modules/categorias/categorias.service.js', () => ({
  getAll:          vi.fn(),
  upsert:          vi.fn(),
  updateThumbnail: vi.fn(),
  remove:          vi.fn(),
}));

vi.mock('../src/config/database.js', () => ({
  query:     vi.fn().mockResolvedValue({ rows: [] }),
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

import * as catService from '../src/modules/categorias/categorias.service.js';
import { index, create, destroy, upsertThumbnail } from '../src/modules/categorias/categorias.controller.js';

// ── Helper: mock Express req/res/next ──────────────────────────────────────

function mockRes() {
  const res = {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
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
    const req = { body: { nombre: '   ' }, user: { id: 'u1', email: 'a@b.com' }, ip: '::1' };
    const res = mockRes();
    await create(req, res, mockNext);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ error: expect.any(String) }));
    expect(catService.upsert).not.toHaveBeenCalled();
  });

  it('retorna 400 cuando nombre está ausente', async () => {
    const req = { body: {}, user: { id: 'u1', email: 'a@b.com' }, ip: '::1' };
    const res = mockRes();
    await create(req, res, mockNext);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('crea categoría y responde 201 con resultado del servicio', async () => {
    catService.upsert.mockResolvedValue(CAT);
    const req = { body: { nombre: 'Biodiversidad' }, user: { id: 'u1', email: 'a@b.com' }, ip: '::1' };
    const res = mockRes();
    await create(req, res, mockNext);
    expect(catService.upsert).toHaveBeenCalledWith('Biodiversidad');
    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json).toHaveBeenCalledWith(CAT);
  });

  it('llama next(err) cuando el servicio lanza', async () => {
    const err = new Error('upsert fail');
    catService.upsert.mockRejectedValue(err);
    const req = { body: { nombre: 'Flora' }, user: { id: 'u1', email: 'a@b.com' }, ip: '::1' };
    const res = mockRes();
    await create(req, res, mockNext);
    expect(mockNext).toHaveBeenCalledWith(err);
  });
});

// ── destroy() ─────────────────────────────────────────────────────────────

describe('categorias.controller → destroy()', () => {
  beforeEach(() => vi.clearAllMocks());

  it('elimina la categoría y responde { ok: true }', async () => {
    catService.remove.mockResolvedValue(undefined);
    const req = { params: { nombre: 'Biodiversidad' }, user: { id: 'u1', email: 'a@b.com' }, ip: '::1' };
    const res = mockRes();
    await destroy(req, res, mockNext);
    expect(catService.remove).toHaveBeenCalledWith('Biodiversidad');
    expect(res.json).toHaveBeenCalledWith({ ok: true });
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
});
