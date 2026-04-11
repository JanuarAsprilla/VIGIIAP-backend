import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import app from '../src/app.js';

// ─── Mock de la capa de servicio ──────────────────────────────────────────────
vi.mock('../src/modules/auth/auth.service.js', () => ({
  login: vi.fn(),
  register: vi.fn(),
  getProfile: vi.fn(),
}));

import * as authService from '../src/modules/auth/auth.service.js';

// ─── Mock del pool de BD (evita conectar a PostgreSQL) ───────────────────────
vi.mock('../src/config/database.js', () => ({
  query: vi.fn(),
  getClient: vi.fn(),
}));

describe('POST /api/auth/login', () => {
  beforeEach(() => vi.clearAllMocks());

  it('retorna 200 y token con credenciales válidas', async () => {
    authService.login.mockResolvedValue({ token: 'jwt-token', user: { id: '1', email: 'a@b.co', rol: 'admin_sig' } });

    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'admin@iiap.gob.pe', password: 'secret123' });

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('token');
  });

  it('retorna 422 si el email es inválido', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'no-es-email', password: 'secret123' });

    expect(res.status).toBe(422);
    expect(res.body).toHaveProperty('fields');
    expect(res.body.fields[0].field).toBe('email');
  });

  it('retorna 422 si falta la contraseña', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'admin@iiap.gob.pe' });

    expect(res.status).toBe(422);
  });

  it('retorna 401 si las credenciales son incorrectas', async () => {
    authService.login.mockRejectedValue(Object.assign(new Error('Credenciales incorrectas'), { status: 401 }));

    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'admin@iiap.gob.pe', password: 'wrong-password' });

    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/credenciales/i);
  });
});

describe('POST /api/auth/registro', () => {
  beforeEach(() => vi.clearAllMocks());

  it('retorna 201 con datos válidos', async () => {
    authService.register.mockResolvedValue({ id: '1', email: 'nuevo@iiap.gob.pe' });

    const res = await request(app)
      .post('/api/auth/registro')
      .send({
        nombre: 'Usuario Nuevo',
        email: 'nuevo@iiap.gob.pe',
        password: 'password123',
        motivo: 'Investigación sobre flora amazónica',
      });

    expect(res.status).toBe(201);
    expect(res.body).toHaveProperty('message');
  });

  it('retorna 422 si el motivo es demasiado corto', async () => {
    const res = await request(app)
      .post('/api/auth/registro')
      .send({
        nombre: 'Test',
        email: 'test@iiap.gob.pe',
        password: 'password123',
        motivo: 'corto',
      });

    expect(res.status).toBe(422);
    expect(res.body.fields.some(f => f.field === 'motivo')).toBe(true);
  });
});

describe('GET /api/auth/me', () => {
  it('retorna 401 sin token', async () => {
    const res = await request(app).get('/api/auth/me');
    expect(res.status).toBe(401);
  });

  it('retorna 401 con token inválido', async () => {
    const res = await request(app)
      .get('/api/auth/me')
      .set('Authorization', 'Bearer token-invalido');
    expect(res.status).toBe(401);
  });
});
