import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import app from '../src/app.js';

vi.mock('../src/modules/admin/admin.service.js', () => ({
  listarUsuarios:   vi.fn(),
  crearUsuario:     vi.fn(),
  actualizarUsuario: vi.fn(),
  eliminarUsuario:  vi.fn(),
  getAuditLog:      vi.fn(),
  getConfiguracion: vi.fn(),
  setConfiguracion: vi.fn(),
}));

vi.mock('../src/config/database.js', () => ({
  query: vi.fn().mockResolvedValue({ rows: [{ count: '42' }] }),
  getClient: vi.fn(),
}));

import * as adminService from '../src/modules/admin/admin.service.js';

const adminToken = jwt.sign(
  { id: 'uuid-admin', email: 'admin@iiap.org.co', rol: 'admin_sig' },
  process.env.JWT_SECRET,
);
const pubToken = jwt.sign(
  { id: 'uuid-pub', email: 'pub@iiap.org.co', rol: 'publico' },
  process.env.JWT_SECRET,
);

// ─── /api/admin/stats ─────────────────────────────────────────────────────────
describe('GET /api/admin/stats', () => {
  it('retorna 401 sin token', async () => {
    const res = await request(app).get('/api/admin/stats');
    expect(res.status).toBe(401);
  });

  it('retorna 403 con rol publico', async () => {
    const res = await request(app)
      .get('/api/admin/stats')
      .set('Authorization', `Bearer ${pubToken}`);
    expect(res.status).toBe(403);
  });

  it('admin obtiene stats — retorna objeto con claves esperadas', async () => {
    const res = await request(app)
      .get('/api/admin/stats')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('usuarios');
    expect(res.body).toHaveProperty('solicitudesPendientes');
    expect(res.body).toHaveProperty('documentos');
    expect(res.body).toHaveProperty('noticias');
    expect(res.body).toHaveProperty('visitantesUltimos30d');
  });
});

// ─── /api/admin/usuarios ──────────────────────────────────────────────────────
describe('GET /api/admin/usuarios', () => {
  beforeEach(() => vi.clearAllMocks());

  it('retorna 403 con rol publico', async () => {
    const res = await request(app)
      .get('/api/admin/usuarios')
      .set('Authorization', `Bearer ${pubToken}`);
    expect(res.status).toBe(403);
  });

  it('admin lista usuarios paginados', async () => {
    adminService.listarUsuarios.mockResolvedValue({
      data: [{ id: 'u1', nombre: 'Admin', rol: 'admin_sig' }],
      meta: { total: 1 },
    });
    const res = await request(app)
      .get('/api/admin/usuarios')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
  });
});

describe('POST /api/admin/usuarios', () => {
  beforeEach(() => vi.clearAllMocks());

  it('retorna 400 si faltan campos obligatorios', async () => {
    const res = await request(app)
      .post('/api/admin/usuarios')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ nombre: 'Solo nombre' });
    expect(res.status).toBe(400);
  });

  it('admin crea usuario — retorna 201', async () => {
    adminService.crearUsuario.mockResolvedValue({
      id: 'u-new', nombre: 'Nuevo Investigador', email: 'inv@iiap.org.co', rol: 'investigador',
    });
    const res = await request(app)
      .post('/api/admin/usuarios')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ nombre: 'Nuevo Investigador', email: 'inv@iiap.org.co', rol: 'investigador' });
    expect(res.status).toBe(201);
    expect(res.body.rol).toBe('investigador');
  });
});

describe('PATCH /api/admin/usuarios/:id', () => {
  beforeEach(() => vi.clearAllMocks());

  it('admin cambia rol — retorna 200', async () => {
    adminService.actualizarUsuario.mockResolvedValue({ id: 'u1', rol: 'investigador', activo: true });
    const res = await request(app)
      .patch('/api/admin/usuarios/u1')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ rol: 'investigador' });
    expect(res.status).toBe(200);
  });

  it('admin activa/desactiva usuario — retorna 200', async () => {
    adminService.actualizarUsuario.mockResolvedValue({ id: 'u1', activo: false });
    const res = await request(app)
      .patch('/api/admin/usuarios/u1')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ activo: false });
    expect(res.status).toBe(200);
    expect(res.body.activo).toBe(false);
  });
});

describe('DELETE /api/admin/usuarios/:id', () => {
  it('admin elimina usuario — retorna 204', async () => {
    adminService.eliminarUsuario.mockResolvedValue();
    const res = await request(app)
      .delete('/api/admin/usuarios/u1')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(204);
  });
});

// ─── /api/admin/audit ─────────────────────────────────────────────────────────
describe('GET /api/admin/audit', () => {
  beforeEach(() => vi.clearAllMocks());

  it('retorna 403 con rol publico', async () => {
    const res = await request(app)
      .get('/api/admin/audit')
      .set('Authorization', `Bearer ${pubToken}`);
    expect(res.status).toBe(403);
  });

  it('admin obtiene log paginado', async () => {
    adminService.getAuditLog.mockResolvedValue({
      data: [{ id: 1, accion: 'login', modulo: 'auth' }],
      meta: { total: 1 },
    });
    const res = await request(app)
      .get('/api/admin/audit')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
  });
});

// ─── /api/admin/configuracion ─────────────────────────────────────────────────
describe('GET /api/admin/configuracion', () => {
  it('retorna 403 con rol publico', async () => {
    const res = await request(app)
      .get('/api/admin/configuracion')
      .set('Authorization', `Bearer ${pubToken}`);
    expect(res.status).toBe(403);
  });

  it('admin obtiene configuración', async () => {
    adminService.getConfiguracion.mockResolvedValue({
      siteName: 'VIGIIAP', region: 'Chocó Biogeográfico',
    });
    const res = await request(app)
      .get('/api/admin/configuracion')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('siteName');
  });
});

describe('PUT /api/admin/configuracion', () => {
  it('retorna 400 con body no-objeto', async () => {
    const res = await request(app)
      .put('/api/admin/configuracion')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('Content-Type', 'application/json')
      .send('"string plano"');
    expect(res.status).toBe(400);
  });

  it('admin guarda configuración — retorna 200', async () => {
    adminService.setConfiguracion.mockResolvedValue();
    const res = await request(app)
      .put('/api/admin/configuracion')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ siteName: 'VIGIIAP v2', modoMantenimiento: 'false' });
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('message');
  });
});
