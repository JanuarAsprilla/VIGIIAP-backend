import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import app from '../src/app.js';

vi.mock('../src/modules/documentos/documentos.service.js', () => ({
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

import * as docService from '../src/modules/documentos/documentos.service.js';

const adminToken = jwt.sign(
  { id: 'uuid-admin', email: 'admin@iiap.org.co', rol: 'admin_sig' },
  process.env.JWT_SECRET,
);
const invToken = jwt.sign(
  { id: 'uuid-inv', email: 'inv@iiap.org.co', rol: 'investigador' },
  process.env.JWT_SECRET,
);
const pubToken = jwt.sign(
  { id: 'uuid-pub', email: 'pub@iiap.org.co', rol: 'publico' },
  process.env.JWT_SECRET,
);

const DOC_FIXTURE = {
  id: 'uuid-doc-1', titulo: 'Informe Biodiversidad 2024',
  slug: 'informe-biodiversidad-2024', tipo: 'Estudios Ambientales',
  anio: 2024, autores: 'IIAP', archivo_url: null, activo: true,
  creado_en: new Date().toISOString(),
};

describe('GET /api/documentos', () => {
  beforeEach(() => vi.clearAllMocks());

  it('retorna lista paginada sin autenticación', async () => {
    docService.getAll.mockResolvedValue({
      data: [DOC_FIXTURE],
      meta: { total: 1, page: 1, totalPages: 1 },
    });
    const res = await request(app).get('/api/documentos');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.data[0].titulo).toBe('Informe Biodiversidad 2024');
  });

  it('acepta filtros de tipo y año como query params', async () => {
    docService.getAll.mockResolvedValue({ data: [], meta: { total: 0 } });
    const res = await request(app).get('/api/documentos?tipo=informe&anio=2024');
    expect(res.status).toBe(200);
    expect(docService.getAll).toHaveBeenCalledWith(
      expect.objectContaining({ tipo: 'informe', anio: '2024' }),
    );
  });
});

describe('GET /api/documentos/:slug', () => {
  it('retorna el documento por slug', async () => {
    docService.getBySlug.mockResolvedValue(DOC_FIXTURE);
    const res = await request(app).get('/api/documentos/informe-biodiversidad-2024');
    expect(res.status).toBe(200);
    expect(res.body.slug).toBe('informe-biodiversidad-2024');
  });

  it('retorna 404 si el slug no existe', async () => {
    docService.getBySlug.mockRejectedValue(
      Object.assign(new Error('Documento no encontrado'), { status: 404 }),
    );
    const res = await request(app).get('/api/documentos/slug-inexistente');
    expect(res.status).toBe(404);
  });
});

describe('POST /api/documentos', () => {
  beforeEach(() => vi.clearAllMocks());

  it('retorna 401 sin token', async () => {
    const res = await request(app).post('/api/documentos').send({});
    expect(res.status).toBe(401);
  });

  it('retorna 403 con rol publico', async () => {
    const res = await request(app)
      .post('/api/documentos')
      .set('Authorization', `Bearer ${pubToken}`)
      .send({ titulo: 'Doc', tipo: 'informe' });
    expect(res.status).toBe(403);
  });

  it('retorna 422 si falta el título', async () => {
    const res = await request(app)
      .post('/api/documentos')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ tipo: 'informe' });
    expect(res.status).toBe(422);
  });

  it('investigador puede subir documento — retorna 201', async () => {
    docService.create.mockResolvedValue(DOC_FIXTURE);
    const res = await request(app)
      .post('/api/documentos')
      .set('Authorization', `Bearer ${invToken}`)
      .send({ titulo: 'Informe Biodiversidad 2024', tipo: 'Estudios Ambientales' });
    expect(res.status).toBe(201);
    expect(res.body.titulo).toBe('Informe Biodiversidad 2024');
  });

  it('admin puede subir documento — retorna 201', async () => {
    docService.create.mockResolvedValue(DOC_FIXTURE);
    const res = await request(app)
      .post('/api/documentos')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ titulo: 'Informe Biodiversidad 2024', tipo: 'Estudios Ambientales' });
    expect(res.status).toBe(201);
  });
});

describe('PUT /api/documentos/:id', () => {
  beforeEach(() => vi.clearAllMocks());

  it('retorna 401 sin token', async () => {
    const res = await request(app).put('/api/documentos/uuid-doc-1').send({});
    expect(res.status).toBe(401);
  });

  it('retorna 403 con rol investigador', async () => {
    const res = await request(app)
      .put('/api/documentos/uuid-doc-1')
      .set('Authorization', `Bearer ${invToken}`)
      .send({ titulo: 'Nuevo título' });
    expect(res.status).toBe(403);
  });

  it('admin puede actualizar — retorna 200', async () => {
    const updated = { ...DOC_FIXTURE, titulo: 'Informe Actualizado' };
    docService.update.mockResolvedValue(updated);
    const res = await request(app)
      .put('/api/documentos/uuid-doc-1')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ titulo: 'Informe Actualizado' });
    expect(res.status).toBe(200);
    expect(res.body.titulo).toBe('Informe Actualizado');
  });

  it('retorna 404 si el documento no existe', async () => {
    docService.update.mockRejectedValue(
      Object.assign(new Error('Documento no encontrado'), { status: 404 }),
    );
    const res = await request(app)
      .put('/api/documentos/uuid-inexistente')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ titulo: 'Título' });
    expect(res.status).toBe(404);
  });
});

describe('DELETE /api/documentos/:id', () => {
  it('retorna 401 sin token', async () => {
    const res = await request(app).delete('/api/documentos/uuid-doc-1');
    expect(res.status).toBe(401);
  });

  it('retorna 403 con rol investigador', async () => {
    const res = await request(app)
      .delete('/api/documentos/uuid-doc-1')
      .set('Authorization', `Bearer ${invToken}`);
    expect(res.status).toBe(403);
  });

  it('admin elimina — retorna 204', async () => {
    docService.remove.mockResolvedValue();
    const res = await request(app)
      .delete('/api/documentos/uuid-doc-1')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(204);
  });
});
