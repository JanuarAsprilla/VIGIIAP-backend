import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import app from '../src/app.js';

vi.mock('../src/modules/usuarios/usuarios.service.js', () => ({
  getProfile:    vi.fn(),
  updatePerfil:  vi.fn(),
  updatePassword: vi.fn(),
}));

vi.mock('../src/config/database.js', () => ({
  query: vi.fn(),
  getClient: vi.fn(),
}));

import * as userService from '../src/modules/usuarios/usuarios.service.js';

const pubToken = jwt.sign(
  { id: 'uuid-pub', email: 'pub@iiap.org.co', rol: 'publico' },
  process.env.JWT_SECRET,
);
// Rol verificado: único con perfil funcional que gestionar (PATCH /me, /me/password)
const verToken = jwt.sign(
  { id: 'uuid-inv', email: 'inv@iiap.org.co', rol: 'investigador' },
  process.env.JWT_SECRET,
);

const USER_FIXTURE = {
  id: 'uuid-inv', nombre: 'Juan Investigador', email: 'inv@iiap.org.co',
  rol: 'investigador', activo: true, institucion: 'IIAP',
};

describe('GET /api/usuarios/me', () => {
  beforeEach(() => vi.clearAllMocks());

  it('retorna 401 sin token', async () => {
    const res = await request(app).get('/api/usuarios/me');
    expect(res.status).toBe(401);
  });

  it('retorna perfil del usuario autenticado', async () => {
    userService.getProfile.mockResolvedValue(USER_FIXTURE);
    const res = await request(app)
      .get('/api/usuarios/me')
      .set('Authorization', `Bearer ${pubToken}`);
    expect(res.status).toBe(200);
    expect(res.body.email).toBe('inv@iiap.org.co');
  });
});

describe('PATCH /api/usuarios/me (actualizar perfil)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('retorna 401 sin token', async () => {
    const res = await request(app).patch('/api/usuarios/me').send({});
    expect(res.status).toBe(401);
  });

  it('retorna 403 si el rol es publico (no verificado)', async () => {
    const res = await request(app)
      .patch('/api/usuarios/me')
      .set('Authorization', `Bearer ${pubToken}`)
      .send({ nombre: 'Juan Carlos' });
    expect(res.status).toBe(403);
  });

  it('retorna 422 si no se envía ningún campo', async () => {
    const res = await request(app)
      .patch('/api/usuarios/me')
      .set('Authorization', `Bearer ${verToken}`)
      .send({});
    expect(res.status).toBe(422);
  });

  it('retorna 422 si el nombre es demasiado corto', async () => {
    const res = await request(app)
      .patch('/api/usuarios/me')
      .set('Authorization', `Bearer ${verToken}`)
      .send({ nombre: 'J' });
    expect(res.status).toBe(422);
  });

  it('actualiza nombre correctamente — retorna 200', async () => {
    const updated = { ...USER_FIXTURE, nombre: 'Juan Carlos Investigador' };
    userService.updatePerfil.mockResolvedValue(updated);
    const res = await request(app)
      .patch('/api/usuarios/me')
      .set('Authorization', `Bearer ${verToken}`)
      .send({ nombre: 'Juan Carlos Investigador' });
    expect(res.status).toBe(200);
    expect(res.body.nombre).toBe('Juan Carlos Investigador');
  });

  it('actualiza institución a null (limpiar campo)', async () => {
    const updated = { ...USER_FIXTURE, institucion: null };
    userService.updatePerfil.mockResolvedValue(updated);
    const res = await request(app)
      .patch('/api/usuarios/me')
      .set('Authorization', `Bearer ${verToken}`)
      .send({ institucion: null });
    expect(res.status).toBe(200);
  });
});

describe('PATCH /api/usuarios/me/password', () => {
  beforeEach(() => vi.clearAllMocks());

  it('retorna 401 sin token', async () => {
    const res = await request(app)
      .patch('/api/usuarios/me/password')
      .send({ currentPassword: 'old', newPassword: 'new' });
    expect(res.status).toBe(401);
  });

  it('retorna 403 si el rol es publico (no verificado)', async () => {
    const res = await request(app)
      .patch('/api/usuarios/me/password')
      .set('Authorization', `Bearer ${pubToken}`)
      .send({ currentPassword: 'OldPass1!', newPassword: 'Nueva123!' });
    expect(res.status).toBe(403);
  });

  it('retorna 422 si la nueva contraseña es débil', async () => {
    const res = await request(app)
      .patch('/api/usuarios/me/password')
      .set('Authorization', `Bearer ${verToken}`)
      .send({ currentPassword: 'OldPass1!', newPassword: 'debil' });
    expect(res.status).toBe(422);
  });

  it('retorna 422 si falta la contraseña actual', async () => {
    const res = await request(app)
      .patch('/api/usuarios/me/password')
      .set('Authorization', `Bearer ${verToken}`)
      .send({ newPassword: 'Nueva123!' });
    expect(res.status).toBe(422);
  });

  it('cambia contraseña con datos válidos — retorna 200', async () => {
    userService.updatePassword.mockResolvedValue();
    const res = await request(app)
      .patch('/api/usuarios/me/password')
      .set('Authorization', `Bearer ${verToken}`)
      .send({ currentPassword: 'OldPass1!', newPassword: 'Nueva123!' });
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('message');
  });
});
