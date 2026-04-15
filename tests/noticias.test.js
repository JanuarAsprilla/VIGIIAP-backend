import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import app from '../src/app.js';

vi.mock('../src/modules/noticias/noticias.service.js', () => ({
  getAll:    vi.fn(),
  getBySlug: vi.fn(),
  create:    vi.fn(),
  update:    vi.fn(),
  remove:    vi.fn(),
}));

vi.mock('../src/config/database.js', () => ({
  query: vi.fn(),
  getClient: vi.fn(),
}));

import * as noticiaService from '../src/modules/noticias/noticias.service.js';

const adminToken = jwt.sign(
  { id: 'uuid-admin', email: 'admin@iiap.org.co', rol: 'admin_sig' },
  process.env.JWT_SECRET,
);
const pubToken = jwt.sign(
  { id: 'uuid-pub', email: 'pub@iiap.org.co', rol: 'publico' },
  process.env.JWT_SECRET,
);

const NOTICIA_FIXTURE = {
  id: 'uuid-n1', titulo: 'Nueva reserva en el Chocó',
  slug: 'nueva-reserva-choco', categoria: 'Conservación',
  resumen: 'Se declara nueva área protegida', publicado: true,
  creado_en: new Date().toISOString(),
};

describe('GET /api/noticias', () => {
  beforeEach(() => vi.clearAllMocks());

  it('retorna lista pública sin autenticación', async () => {
    noticiaService.getAll.mockResolvedValue({
      data: [NOTICIA_FIXTURE],
      meta: { total: 1, page: 1, totalPages: 1 },
    });
    const res = await request(app).get('/api/noticias');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
  });

  it('acepta parámetros de paginación', async () => {
    noticiaService.getAll.mockResolvedValue({ data: [], meta: { total: 0 } });
    const res = await request(app).get('/api/noticias?page=2&limit=5');
    expect(res.status).toBe(200);
  });
});

describe('GET /api/noticias/:slug', () => {
  it('retorna noticia por slug', async () => {
    noticiaService.getBySlug.mockResolvedValue(NOTICIA_FIXTURE);
    const res = await request(app).get('/api/noticias/nueva-reserva-choco');
    expect(res.status).toBe(200);
    expect(res.body.titulo).toBe('Nueva reserva en el Chocó');
  });

  it('retorna 404 si el slug no existe', async () => {
    noticiaService.getBySlug.mockRejectedValue(
      Object.assign(new Error('Noticia no encontrada'), { status: 404 }),
    );
    const res = await request(app).get('/api/noticias/slug-inexistente');
    expect(res.status).toBe(404);
  });
});

describe('POST /api/noticias', () => {
  beforeEach(() => vi.clearAllMocks());

  it('retorna 401 sin token', async () => {
    const res = await request(app).post('/api/noticias').send({});
    expect(res.status).toBe(401);
  });

  it('retorna 403 con rol publico', async () => {
    const res = await request(app)
      .post('/api/noticias')
      .set('Authorization', `Bearer ${pubToken}`)
      .send({ titulo: 'Test' });
    expect(res.status).toBe(403);
  });

  it('retorna 422 si falta el título', async () => {
    const res = await request(app)
      .post('/api/noticias')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ categoria: 'Conservación' });
    expect(res.status).toBe(422);
  });

  it('admin crea noticia — retorna 201', async () => {
    noticiaService.create.mockResolvedValue(NOTICIA_FIXTURE);
    const res = await request(app)
      .post('/api/noticias')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ titulo: 'Nueva reserva en el Chocó', categoria: 'Conservación' });
    expect(res.status).toBe(201);
    expect(res.body.titulo).toBe('Nueva reserva en el Chocó');
  });
});

describe('PUT /api/noticias/:id', () => {
  beforeEach(() => vi.clearAllMocks());

  it('retorna 401 sin token', async () => {
    const res = await request(app).put('/api/noticias/uuid-n1').send({});
    expect(res.status).toBe(401);
  });

  it('retorna 403 con rol publico', async () => {
    const res = await request(app)
      .put('/api/noticias/uuid-n1')
      .set('Authorization', `Bearer ${pubToken}`)
      .send({ titulo: 'Nuevo título' });
    expect(res.status).toBe(403);
  });

  it('admin actualiza — retorna 200', async () => {
    const updated = { ...NOTICIA_FIXTURE, titulo: 'Título Actualizado' };
    noticiaService.update.mockResolvedValue(updated);
    const res = await request(app)
      .put('/api/noticias/uuid-n1')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ titulo: 'Título Actualizado' });
    expect(res.status).toBe(200);
    expect(res.body.titulo).toBe('Título Actualizado');
  });
});

describe('DELETE /api/noticias/:id', () => {
  it('retorna 401 sin token', async () => {
    const res = await request(app).delete('/api/noticias/uuid-n1');
    expect(res.status).toBe(401);
  });

  it('retorna 403 con rol publico', async () => {
    const res = await request(app)
      .delete('/api/noticias/uuid-n1')
      .set('Authorization', `Bearer ${pubToken}`);
    expect(res.status).toBe(403);
  });

  it('admin elimina — retorna 204', async () => {
    noticiaService.remove.mockResolvedValue();
    const res = await request(app)
      .delete('/api/noticias/uuid-n1')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(204);
  });
});
