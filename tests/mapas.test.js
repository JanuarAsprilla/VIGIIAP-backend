import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import app from '../src/app.js';

vi.mock('../src/modules/mapas/mapas.service.js', () => ({
  getAll:     vi.fn(),
  getBySlug:  vi.fn(),
  create:     vi.fn(),
  update:     vi.fn(),
  remove:     vi.fn(),
}));

vi.mock('../src/config/database.js', () => ({
  query: vi.fn(),
  getClient: vi.fn(),
}));

import * as mapaService from '../src/modules/mapas/mapas.service.js';

// Tokens de prueba
const adminToken = jwt.sign({ id: 'uuid-admin', email: 'admin@iiap.gob.pe', rol: 'admin_sig' }, process.env.JWT_SECRET);
const publicToken = jwt.sign({ id: 'uuid-pub', email: 'pub@iiap.gob.pe', rol: 'publico' }, process.env.JWT_SECRET);

describe('GET /api/mapas', () => {
  beforeEach(() => vi.clearAllMocks());

  it('retorna lista paginada (público, sin auth)', async () => {
    mapaService.getAll.mockResolvedValue({
      data: [{ id: '1', titulo: 'Mapa de biomas', slug: 'mapa-de-biomas' }],
      meta: { total: 1, page: 1, totalPages: 1 },
    });

    const res = await request(app).get('/api/mapas');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
  });
});

describe('GET /api/mapas/:slug', () => {
  it('retorna 404 si el mapa no existe', async () => {
    mapaService.getBySlug.mockRejectedValue(Object.assign(new Error('Mapa no encontrado'), { status: 404 }));
    const res = await request(app).get('/api/mapas/slug-inexistente');
    expect(res.status).toBe(404);
  });
});

describe('POST /api/mapas', () => {
  beforeEach(() => vi.clearAllMocks());

  it('retorna 401 sin token', async () => {
    const res = await request(app).post('/api/mapas').send({ titulo: 'Test', categoria: 'Biodiversidad' });
    expect(res.status).toBe(401);
  });

  it('retorna 403 con rol publico', async () => {
    const res = await request(app)
      .post('/api/mapas')
      .set('Authorization', `Bearer ${publicToken}`)
      .send({ titulo: 'Test', categoria: 'Biodiversidad' });
    expect(res.status).toBe(403);
  });

  it('retorna 422 si falta el título', async () => {
    const res = await request(app)
      .post('/api/mapas')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ categoria: 'Biodiversidad' });
    expect(res.status).toBe(422);
  });

  it('retorna 201 con datos válidos y rol admin_sig', async () => {
    const mapa = { id: 'uuid-1', titulo: 'Mapa Amazónico', slug: 'mapa-amazonico', categoria: 'Biodiversidad' };
    mapaService.create.mockResolvedValue(mapa);

    const res = await request(app)
      .post('/api/mapas')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ titulo: 'Mapa Amazónico', categoria: 'Biodiversidad' });

    expect(res.status).toBe(201);
    expect(res.body.titulo).toBe('Mapa Amazónico');
  });
});

describe('DELETE /api/mapas/:id', () => {
  it('retorna 204 con admin_sig', async () => {
    mapaService.remove.mockResolvedValue();
    const res = await request(app)
      .delete('/api/mapas/uuid-1')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(204);
  });

  it('retorna 403 con rol publico', async () => {
    const res = await request(app)
      .delete('/api/mapas/uuid-1')
      .set('Authorization', `Bearer ${publicToken}`);
    expect(res.status).toBe(403);
  });
});
