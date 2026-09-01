import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import app from '../src/app.js';

vi.mock('../src/modules/usuarios/usuarios.service.js', () => ({
  getProfile:    vi.fn(),
  updatePerfil:  vi.fn(),
  updateAvatar:  vi.fn(),
  updatePassword: vi.fn(),
  getAll:        vi.fn(),
  updateRol:     vi.fn(),
}));

vi.mock('../src/config/database.js', () => ({
  query: vi.fn(),
  getClient: vi.fn(),
}));

vi.mock('../src/config/r2.js', () => ({
  uploadFile: vi.fn().mockResolvedValue('https://files.test.local/avatars/foto.png'),
  deleteFile: vi.fn(),
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
const adminToken = jwt.sign(
  { id: 'uuid-admin', email: 'admin@iiap.org.co', rol: 'admin_sig' },
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

describe('PATCH /api/usuarios/me/avatar', () => {
  beforeEach(() => vi.clearAllMocks());

  it('retorna 401 sin token', async () => {
    const res = await request(app).patch('/api/usuarios/me/avatar');
    expect(res.status).toBe(401);
  });

  it('retorna 403 si el rol es publico (no verificado)', async () => {
    const res = await request(app)
      .patch('/api/usuarios/me/avatar')
      .set('Authorization', `Bearer ${pubToken}`);
    expect(res.status).toBe(403);
  });

  it('retorna 422 si no se envía ningún archivo', async () => {
    const res = await request(app)
      .patch('/api/usuarios/me/avatar')
      .set('Authorization', `Bearer ${verToken}`);
    expect(res.status).toBe(422);
    expect(userService.updateAvatar).not.toHaveBeenCalled();
  });

  it('sube un avatar válido — retorna 200 con el usuario actualizado y audita la acción', async () => {
    userService.updateAvatar.mockResolvedValue({ ...USER_FIXTURE, avatar_url: 'https://files.test.local/avatars/foto.png' });
    const pngBuffer = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, ...Array(24).fill(0)]);

    const res = await request(app)
      .patch('/api/usuarios/me/avatar')
      .set('Authorization', `Bearer ${verToken}`)
      .attach('avatar', pngBuffer, 'foto.png');

    expect(res.status).toBe(200);
    expect(res.body.avatar_url).toBe('https://files.test.local/avatars/foto.png');
    expect(userService.updateAvatar).toHaveBeenCalledWith('uuid-inv', 'https://files.test.local/avatars/foto.png');
  });

  it('propaga el error al middleware de errores si el service falla', async () => {
    userService.updateAvatar.mockRejectedValue(Object.assign(new Error('DB down'), { status: 500 }));
    const pngBuffer = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, ...Array(24).fill(0)]);

    const res = await request(app)
      .patch('/api/usuarios/me/avatar')
      .set('Authorization', `Bearer ${verToken}`)
      .attach('avatar', pngBuffer, 'foto.png');

    expect(res.status).toBe(500);
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

  it('invalida el access token actual tras cambiar la contraseña — reutilizarlo debe fallar', async () => {
    userService.updatePassword.mockResolvedValue();
    // Token con `exp` real (verToken no lleva expiresIn, así que req.user.exp sería undefined)
    const tokenConExp = jwt.sign(
      { id: 'uuid-inv', email: 'inv@iiap.org.co', rol: 'investigador' },
      process.env.JWT_SECRET,
      { expiresIn: '1h' }
    );

    const res = await request(app)
      .patch('/api/usuarios/me/password')
      .set('Authorization', `Bearer ${tokenConExp}`)
      .send({ currentPassword: 'OldPass1!', newPassword: 'Nueva123!' });
    expect(res.status).toBe(200);

    // El mismo token ya no debe servir para autenticar
    const res2 = await request(app)
      .get('/api/usuarios/me')
      .set('Authorization', `Bearer ${tokenConExp}`);
    expect(res2.status).toBe(401);
  });
});

describe('GET /api/usuarios', () => {
  beforeEach(() => vi.clearAllMocks());

  it('retorna 401 sin token', async () => {
    const res = await request(app).get('/api/usuarios');
    expect(res.status).toBe(401);
  });

  it('retorna 403 con rol no admin_sig', async () => {
    const res = await request(app)
      .get('/api/usuarios')
      .set('Authorization', `Bearer ${verToken}`);
    expect(res.status).toBe(403);
  });

  it('retorna la lista de usuarios con rol admin_sig', async () => {
    userService.getAll.mockResolvedValue({ data: [USER_FIXTURE], total: 1 });
    const res = await request(app)
      .get('/api/usuarios')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
  });

  it('llama next(err) si el servicio lanza', async () => {
    userService.getAll.mockRejectedValue(new Error('db down'));
    const res = await request(app)
      .get('/api/usuarios')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(500);
  });
});

describe('PATCH /api/usuarios/:id/rol', () => {
  beforeEach(() => vi.clearAllMocks());

  it('retorna 401 sin token', async () => {
    const res = await request(app).patch('/api/usuarios/uuid-x/rol').send({ rol: 'tecnico' });
    expect(res.status).toBe(401);
  });

  it('retorna 403 con rol no admin_sig', async () => {
    const res = await request(app)
      .patch('/api/usuarios/uuid-x/rol')
      .set('Authorization', `Bearer ${verToken}`)
      .send({ rol: 'tecnico' });
    expect(res.status).toBe(403);
  });

  it('retorna 422 si el rol no es válido', async () => {
    const res = await request(app)
      .patch('/api/usuarios/uuid-x/rol')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ rol: 'rol-inexistente' });
    expect(res.status).toBe(422);
  });

  it('actualiza el rol con datos válidos — retorna 200', async () => {
    userService.updateRol.mockResolvedValue({ ...USER_FIXTURE, rol: 'tecnico' });
    const res = await request(app)
      .patch('/api/usuarios/uuid-inv/rol')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ rol: 'tecnico', activo: true });
    expect(res.status).toBe(200);
    expect(res.body.rol).toBe('tecnico');
    expect(userService.updateRol).toHaveBeenCalledWith(
      'uuid-inv', 'tecnico', true, expect.objectContaining({ rol: 'admin_sig' }),
    );
  });

  it('llama next(err) si el servicio lanza (ej. protección de super_admin)', async () => {
    userService.updateRol.mockRejectedValue(Object.assign(new Error('No autorizado'), { status: 403 }));
    const res = await request(app)
      .patch('/api/usuarios/uuid-super/rol')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ rol: 'tecnico' });
    expect(res.status).toBe(403);
  });
});
