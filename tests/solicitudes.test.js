import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import app from '../src/app.js';

vi.mock('../src/modules/solicitudes/solicitudes.service.js', () => ({
  getAll:        vi.fn(),
  getMine:       vi.fn(),
  create:        vi.fn(),
  updateEstado:  vi.fn(),
}));

vi.mock('../src/config/database.js', () => ({
  query: vi.fn().mockResolvedValue({ rows: [] }),
  getClient: vi.fn(),
}));

import * as solService from '../src/modules/solicitudes/solicitudes.service.js';

const adminToken = jwt.sign(
  { id: 'uuid-admin', email: 'admin@iiap.org.co', rol: 'admin_sig' },
  process.env.JWT_SECRET,
);
const pubToken = jwt.sign(
  { id: 'uuid-pub', email: 'pub@iiap.org.co', rol: 'publico' },
  process.env.JWT_SECRET,
);

const SOL_FIXTURE = {
  id: 'uuid-sol-1', tipo: 'Acceso a datos',
  descripcion: 'Solicito acceso a datos de biodiversidad',
  estado: 'pendiente', creado_en: new Date().toISOString(),
};

describe('GET /api/solicitudes (admin)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('retorna 401 sin token', async () => {
    const res = await request(app).get('/api/solicitudes');
    expect(res.status).toBe(401);
  });

  it('retorna 403 con rol publico', async () => {
    const res = await request(app)
      .get('/api/solicitudes')
      .set('Authorization', `Bearer ${pubToken}`);
    expect(res.status).toBe(403);
  });

  it('admin obtiene lista paginada', async () => {
    solService.getAll.mockResolvedValue({
      data: [SOL_FIXTURE],
      meta: { total: 1, page: 1 },
    });
    const res = await request(app)
      .get('/api/solicitudes')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
  });
});

describe('GET /api/solicitudes/mis-solicitudes', () => {
  beforeEach(() => vi.clearAllMocks());

  it('retorna 401 sin token', async () => {
    const res = await request(app).get('/api/solicitudes/mis-solicitudes');
    expect(res.status).toBe(401);
  });

  it('usuario autenticado ve sus solicitudes', async () => {
    solService.getMine.mockResolvedValue({
      data: [SOL_FIXTURE],
      meta: { total: 1 },
    });
    const res = await request(app)
      .get('/api/solicitudes/mis-solicitudes')
      .set('Authorization', `Bearer ${pubToken}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
  });
});

describe('POST /api/solicitudes', () => {
  beforeEach(() => vi.clearAllMocks());

  it('retorna 401 sin token', async () => {
    const res = await request(app).post('/api/solicitudes').send({});
    expect(res.status).toBe(401);
  });

  it('retorna 422 si falta el tipo', async () => {
    const res = await request(app)
      .post('/api/solicitudes')
      .set('Authorization', `Bearer ${pubToken}`)
      .send({ descripcion: 'Sin tipo' });
    expect(res.status).toBe(422);
  });

  it('usuario autenticado crea solicitud — retorna 201', async () => {
    solService.create.mockResolvedValue(SOL_FIXTURE);
    const res = await request(app)
      .post('/api/solicitudes')
      .set('Authorization', `Bearer ${pubToken}`)
      .send({ tipo: 'acceso', descripcion: 'Solicito acceso a datos de biodiversidad' });
    expect(res.status).toBe(201);
  });
});

describe('PATCH /api/solicitudes/:id/estado', () => {
  beforeEach(() => vi.clearAllMocks());

  it('retorna 401 sin token', async () => {
    const res = await request(app)
      .patch('/api/solicitudes/uuid-sol-1/estado')
      .send({ estado: 'aprobada' });
    expect(res.status).toBe(401);
  });

  it('retorna 403 con rol publico', async () => {
    const res = await request(app)
      .patch('/api/solicitudes/uuid-sol-1/estado')
      .set('Authorization', `Bearer ${pubToken}`)
      .send({ estado: 'aprobada' });
    expect(res.status).toBe(403);
  });

  it('admin aprueba solicitud — retorna 200', async () => {
    solService.updateEstado.mockResolvedValue({ ...SOL_FIXTURE, estado: 'aprobada' });
    const res = await request(app)
      .patch('/api/solicitudes/uuid-sol-1/estado')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ estado: 'aprobada' });
    expect(res.status).toBe(200);
    expect(res.body.estado).toBe('aprobada');
  });

  it('admin rechaza solicitud — retorna 200', async () => {
    solService.updateEstado.mockResolvedValue({ ...SOL_FIXTURE, estado: 'rechazada' });
    const res = await request(app)
      .patch('/api/solicitudes/uuid-sol-1/estado')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ estado: 'rechazada', nota: 'Información incompleta' });
    expect(res.status).toBe(200);
    expect(res.body.estado).toBe('rechazada');
  });

  it('admin marca en revisión — retorna 200', async () => {
    solService.updateEstado.mockResolvedValue({ ...SOL_FIXTURE, estado: 'en_revision' });
    const res = await request(app)
      .patch('/api/solicitudes/uuid-sol-1/estado')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ estado: 'en_revision' });
    expect(res.status).toBe(200);
    expect(res.body.estado).toBe('en_revision');
  });

  it('retorna 422 con estado inválido', async () => {
    const res = await request(app)
      .patch('/api/solicitudes/uuid-sol-1/estado')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ estado: 'estado_inventado' });
    expect(res.status).toBe(422);
  });
});
