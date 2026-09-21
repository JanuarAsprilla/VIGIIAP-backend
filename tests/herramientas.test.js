import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';

vi.mock('../src/modules/herramientas/herramientas.service.js', () => ({
  listar:     vi.fn(),
  crear:      vi.fn(),
  actualizar: vi.fn(),
  reordenar:  vi.fn(),
  eliminar:   vi.fn(),
}));

// query() aquí solo lo consume requireModulo (herramientas.service.js está
// mockeado arriba) — por defecto el admin_sig de prueba tiene el módulo habilitado.
vi.mock('../src/config/database.js', () => ({
  query:     vi.fn().mockResolvedValue({ rows: [{ puede_ver: true, puede_editar: true }] }),
  getClient: vi.fn(),
}));

vi.mock('../src/utils/auditLog.js', () => ({
  registrarAuditoria: vi.fn(),
}));

vi.mock('../src/middlewares/cache.js', () => ({
  invalidateCache: vi.fn().mockRejectedValue(new Error('redis no disponible')),
  cacheMiddleware: () => (_req, _res, next) => next(),
  getRedisClient:  vi.fn(() => null),
}));

import * as herramientasService from '../src/modules/herramientas/herramientas.service.js';
import { index, create, update, reorder, destroy } from '../src/modules/herramientas/herramientas.controller.js';

function mockRes() {
  const res = { status: vi.fn().mockReturnThis(), json: vi.fn().mockReturnThis(), end: vi.fn() };
  return res;
}
const mockNext = vi.fn();

const HERRAMIENTA = { clave: 'conversor', titulo: 'Conversor de Coordenadas', tag: 'Geodésico', activa: true, orden: 0 };

// ── index() ────────────────────────────────────────────────────────────────

describe('herramientas.controller → index()', () => {
  beforeEach(() => vi.clearAllMocks());

  it('responde con la lista del servicio, isAdminView=false sin usuario', async () => {
    herramientasService.listar.mockResolvedValue([HERRAMIENTA]);
    const res = mockRes();
    await index({ query: {} }, res, mockNext);
    expect(herramientasService.listar).toHaveBeenCalledWith(false, undefined);
    expect(res.json).toHaveBeenCalledWith([HERRAMIENTA]);
  });

  it('admin=true con rol admin_sig activa isAdminView', async () => {
    herramientasService.listar.mockResolvedValue([HERRAMIENTA]);
    const res = mockRes();
    const user = { rol: 'admin_sig' }
    await index({ query: { admin: 'true' }, user }, res, mockNext);
    expect(herramientasService.listar).toHaveBeenCalledWith(true, user);
  });

  it('admin=true sin rol admin/super_admin se ignora', async () => {
    herramientasService.listar.mockResolvedValue([HERRAMIENTA]);
    const res = mockRes();
    const user = { rol: 'investigador' }
    await index({ query: { admin: 'true' }, user }, res, mockNext);
    expect(herramientasService.listar).toHaveBeenCalledWith(false, user);
  });

  it('propaga req.user al servicio para filtrar por visibilidad', async () => {
    herramientasService.listar.mockResolvedValue([HERRAMIENTA]);
    const res = mockRes();
    const user = { rol: 'investigador' }
    await index({ query: {}, user }, res, mockNext);
    expect(herramientasService.listar).toHaveBeenCalledWith(false, user);
  });

  it('llama next(err) cuando el servicio lanza', async () => {
    const err = new Error('DB failure');
    herramientasService.listar.mockRejectedValue(err);
    const res = mockRes();
    await index({ query: {} }, res, mockNext);
    expect(mockNext).toHaveBeenCalledWith(err);
  });
});

// ── create() ──────────────────────────────────────────────────────────────

describe('herramientas.controller → create()', () => {
  beforeEach(() => vi.clearAllMocks());
  const baseReq = { user: { id: 'u1', email: 'a@b.com' }, ip: '::1' };

  it('retorna 400 con clave inválida (mayúsculas)', async () => {
    const req = { ...baseReq, body: { clave: 'Conversor', titulo: 'X', tag: 'Y' } };
    const res = mockRes();
    await create(req, res, mockNext);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(herramientasService.crear).not.toHaveBeenCalled();
  });

  it('retorna 400 sin título', async () => {
    const req = { ...baseReq, body: { clave: 'nueva', tag: 'Y' } };
    const res = mockRes();
    await create(req, res, mockNext);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('crea y responde 201 con el resultado del servicio', async () => {
    herramientasService.crear.mockResolvedValue(HERRAMIENTA);
    const req = { ...baseReq, body: { clave: 'conversor', titulo: 'Conversor de Coordenadas', tag: 'Geodésico' } };
    const res = mockRes();
    await create(req, res, mockNext);
    expect(herramientasService.crear).toHaveBeenCalledWith(expect.objectContaining({ clave: 'conversor' }));
    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json).toHaveBeenCalledWith(HERRAMIENTA);
  });

  it('retorna 409 si la clave ya existe (colisión de PK)', async () => {
    herramientasService.crear.mockRejectedValue(Object.assign(new Error('dup'), { code: '23505' }));
    const req = { ...baseReq, body: { clave: 'conversor', titulo: 'Conversor', tag: 'Geodésico' } };
    const res = mockRes();
    await create(req, res, mockNext);
    expect(res.status).toHaveBeenCalledWith(409);
  });

  it('llama next(err) para otros errores del servicio', async () => {
    const err = new Error('otro error');
    herramientasService.crear.mockRejectedValue(err);
    const req = { ...baseReq, body: { clave: 'conversor', titulo: 'Conversor', tag: 'Geodésico' } };
    const res = mockRes();
    await create(req, res, mockNext);
    expect(mockNext).toHaveBeenCalledWith(err);
  });
});

// ── update() ──────────────────────────────────────────────────────────────

describe('herramientas.controller → update()', () => {
  beforeEach(() => vi.clearAllMocks());
  const baseReq = { user: { id: 'u1', email: 'a@b.com' }, ip: '::1' };

  it('retorna 400 con body vacío', async () => {
    const req = { ...baseReq, params: { clave: 'conversor' }, body: {} };
    const res = mockRes();
    await update(req, res, mockNext);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(herramientasService.actualizar).not.toHaveBeenCalled();
  });

  it('actualiza y responde con el resultado', async () => {
    herramientasService.actualizar.mockResolvedValue({ ...HERRAMIENTA, activa: false });
    const req = { ...baseReq, params: { clave: 'conversor' }, body: { activa: false } };
    const res = mockRes();
    await update(req, res, mockNext);
    expect(herramientasService.actualizar).toHaveBeenCalledWith('conversor', { activa: false });
    expect(res.json).toHaveBeenCalledWith({ ...HERRAMIENTA, activa: false });
  });

  it('decodifica la clave del parámetro URL', async () => {
    herramientasService.actualizar.mockResolvedValue(HERRAMIENTA);
    const req = { ...baseReq, params: { clave: 'panel%2Dchoco' }, body: { activa: true } };
    const res = mockRes();
    await update(req, res, mockNext);
    expect(herramientasService.actualizar).toHaveBeenCalledWith('panel-choco', { activa: true });
  });

  it('llama next(err) cuando el servicio lanza (ej. 404)', async () => {
    const err = Object.assign(new Error('no encontrada'), { status: 404 });
    herramientasService.actualizar.mockRejectedValue(err);
    const req = { ...baseReq, params: { clave: 'no-existe' }, body: { activa: false } };
    const res = mockRes();
    await update(req, res, mockNext);
    expect(mockNext).toHaveBeenCalledWith(err);
  });
});

// ── reorder() ─────────────────────────────────────────────────────────────

describe('herramientas.controller → reorder()', () => {
  beforeEach(() => vi.clearAllMocks());
  const baseReq = { user: { id: 'u1', email: 'a@b.com' }, ip: '::1' };

  it('retorna 400 con un arreglo vacío', async () => {
    const req = { ...baseReq, body: [] };
    const res = mockRes();
    await reorder(req, res, mockNext);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(herramientasService.reordenar).not.toHaveBeenCalled();
  });

  it('reordena y responde con el catálogo completo actualizado', async () => {
    herramientasService.reordenar.mockResolvedValue(undefined);
    herramientasService.listar.mockResolvedValue([HERRAMIENTA]);
    const req = { ...baseReq, body: [{ clave: 'conversor', orden: 1 }] };
    const res = mockRes();
    await reorder(req, res, mockNext);
    expect(herramientasService.reordenar).toHaveBeenCalledWith([{ clave: 'conversor', orden: 1 }]);
    expect(herramientasService.listar).toHaveBeenCalledWith(true);
    expect(res.json).toHaveBeenCalledWith([HERRAMIENTA]);
  });

  it('llama next(err) cuando el servicio lanza', async () => {
    const err = Object.assign(new Error('no encontrada'), { status: 404 });
    herramientasService.reordenar.mockRejectedValue(err);
    const req = { ...baseReq, body: [{ clave: 'no-existe', orden: 0 }] };
    const res = mockRes();
    await reorder(req, res, mockNext);
    expect(mockNext).toHaveBeenCalledWith(err);
  });
});

// ── destroy() ─────────────────────────────────────────────────────────────

describe('herramientas.controller → destroy()', () => {
  beforeEach(() => vi.clearAllMocks());

  it('elimina y responde 204 sin cuerpo', async () => {
    herramientasService.eliminar.mockResolvedValue(undefined);
    const req = { params: { clave: 'conversor' }, user: { id: 'u1', email: 'a@b.com' }, ip: '::1' };
    const res = mockRes();
    await destroy(req, res, mockNext);
    expect(herramientasService.eliminar).toHaveBeenCalledWith('conversor');
    expect(res.status).toHaveBeenCalledWith(204);
    expect(res.end).toHaveBeenCalled();
  });

  it('llama next(err) cuando el servicio lanza', async () => {
    const err = Object.assign(new Error('no encontrada'), { status: 404 });
    herramientasService.eliminar.mockRejectedValue(err);
    const req = { params: { clave: 'no-existe' }, user: { id: 'u1', email: 'a@b.com' }, ip: '::1' };
    const res = mockRes();
    await destroy(req, res, mockNext);
    expect(mockNext).toHaveBeenCalledWith(err);
  });
});

// ── Integration via supertest (auth + routing) ─────────────────────────────

describe('Herramientas routes — auth guards via supertest', () => {
  let app;

  beforeEach(async () => {
    vi.clearAllMocks();
    app = (await import('../src/app.js')).default;
  });

  const adminToken = jwt.sign(
    { id: 'uuid-admin', email: 'admin@iiap.org.co', rol: 'admin_sig' },
    process.env.JWT_SECRET,
  );

  it('GET /api/herramientas → 200 sin autenticación (público)', async () => {
    herramientasService.listar.mockResolvedValue([HERRAMIENTA]);
    const res = await request(app).get('/api/herramientas');
    expect(res.status).toBe(200);
    expect(herramientasService.listar).toHaveBeenCalledWith(false, undefined);
  });

  it('GET /api/herramientas con token investigador → propaga el usuario al servicio', async () => {
    herramientasService.listar.mockResolvedValue([HERRAMIENTA]);
    const investigadorToken = jwt.sign(
      { id: 'uuid-inv', email: 'inv@iiap.org.co', rol: 'investigador' },
      process.env.JWT_SECRET,
    );
    const res = await request(app).get('/api/herramientas').set('Authorization', `Bearer ${investigadorToken}`);
    expect(res.status).toBe(200);
    expect(herramientasService.listar).toHaveBeenCalledWith(false, expect.objectContaining({ rol: 'investigador' }));
  });

  it('POST /api/herramientas → 401 sin token', async () => {
    const res = await request(app).post('/api/herramientas').send({ clave: 'x', titulo: 'X', tag: 'Y' });
    expect(res.status).toBe(401);
  });

  it('PATCH /api/herramientas/:clave → 401 sin token', async () => {
    const res = await request(app).patch('/api/herramientas/conversor').send({ activa: false });
    expect(res.status).toBe(401);
  });

  it('PATCH /api/herramientas/reordenar → 401 sin token', async () => {
    const res = await request(app).patch('/api/herramientas/reordenar').send([{ clave: 'conversor', orden: 0 }]);
    expect(res.status).toBe(401);
  });

  it('DELETE /api/herramientas/:clave → 401 sin token', async () => {
    const res = await request(app).delete('/api/herramientas/conversor');
    expect(res.status).toBe(401);
  });

  it('PATCH /api/herramientas/:clave → 200 con token admin_sig y módulo habilitado', async () => {
    herramientasService.actualizar.mockResolvedValue({ ...HERRAMIENTA, activa: false });
    const res = await request(app)
      .patch('/api/herramientas/conversor')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ activa: false });
    expect(res.status).toBe(200);
    expect(herramientasService.actualizar).toHaveBeenCalledWith('conversor', { activa: false });
  });

  it('PATCH /api/herramientas/reordenar → 200 con token admin_sig, resuelve antes que /:clave', async () => {
    herramientasService.reordenar.mockResolvedValue(undefined);
    herramientasService.listar.mockResolvedValue([HERRAMIENTA]);
    const res = await request(app)
      .patch('/api/herramientas/reordenar')
      .set('Authorization', `Bearer ${adminToken}`)
      .send([{ clave: 'conversor', orden: 1 }]);
    expect(res.status).toBe(200);
    expect(herramientasService.reordenar).toHaveBeenCalledWith([{ clave: 'conversor', orden: 1 }]);
  });

  it('POST /api/herramientas → 201 con token admin_sig y módulo habilitado', async () => {
    herramientasService.crear.mockResolvedValue(HERRAMIENTA);
    const res = await request(app)
      .post('/api/herramientas')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ clave: 'conversor', titulo: 'Conversor de Coordenadas', tag: 'Geodésico' });
    expect(res.status).toBe(201);
  });

  it('DELETE /api/herramientas/:clave → 204 con token admin_sig y módulo habilitado', async () => {
    herramientasService.eliminar.mockResolvedValue(undefined);
    const res = await request(app)
      .delete('/api/herramientas/conversor')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(204);
  });
});
