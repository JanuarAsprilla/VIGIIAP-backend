/**
 * Verificación end-to-end del cableado de csrfProtection en las rutas reales
 * (a diferencia de tests/csrf.test.js, que prueba el middleware aislado).
 *
 * Todas las demás suites de rutas (admin.test.js, usuarios.test.js, etc.)
 * autentican vía Authorization: Bearer, nunca vía cookie — por diseño,
 * csrfProtection es un no-op quando no hay cookie de sesión, así que esas
 * suites siguen pasando sin cambios. Esta suite es la que ejercita el
 * camino de cookie real (el que un navegador usa).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import app from '../src/app.js';
import { generateCsrfToken } from '../src/utils/csrf.js';

vi.mock('../src/modules/admin/admin.service.js', () => ({
  listarUsuarios:    vi.fn(),
  crearUsuario:      vi.fn(),
  actualizarUsuario: vi.fn(),
  eliminarUsuario:   vi.fn(),
  getAuditLog:       vi.fn(),
  getConfiguracion:  vi.fn(),
  setConfiguracion:  vi.fn(),
}));

vi.mock('../src/config/database.js', () => ({
  query:     vi.fn().mockResolvedValue({ rows: [{ count: '42' }] }),
  getClient: vi.fn(),
}));

import * as adminService from '../src/modules/admin/admin.service.js';

const adminToken = jwt.sign(
  { id: 'uuid-admin', email: 'admin@iiap.org.co', rol: 'admin_sig' },
  process.env.JWT_SECRET,
);

describe('GET /api/auth/csrf-token', () => {
  it('retorna 401 sin sesión', async () => {
    const res = await request(app).get('/api/auth/csrf-token');
    expect(res.status).toBe(401);
  });

  it('retorna 401 si solo hay Authorization: Bearer (sin cookie de sesión)', async () => {
    // El token CSRF está ligado a la cookie httpOnly; los clientes Bearer no
    // la usan y por tanto no tienen nada que "forjar" — no necesitan el token.
    const res = await request(app)
      .get('/api/auth/csrf-token')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(401);
  });

  it('con cookie de sesión retorna un token CSRF válido para esa cookie', async () => {
    const res = await request(app)
      .get('/api/auth/csrf-token')
      .set('Cookie', [`vigiiap_token=${adminToken}`]);
    expect(res.status).toBe(200);
    expect(res.body.csrfToken).toBe(generateCsrfToken(adminToken));
  });
});

describe('POST /api/admin/usuarios — autenticado por cookie (camino de navegador)', () => {
  beforeEach(() => vi.clearAllMocks());

  const payload = { nombre: 'Nuevo Investigador', email: 'inv@iiap.org.co', rol: 'investigador' };

  it('rechaza con 403 si falta el header X-CSRF-Token', async () => {
    const res = await request(app)
      .post('/api/admin/usuarios')
      .set('Cookie', [`vigiiap_token=${adminToken}`])
      .send(payload);
    expect(res.status).toBe(403);
    expect(adminService.crearUsuario).not.toHaveBeenCalled();
  });

  it('rechaza con 403 si el header X-CSRF-Token no corresponde a la cookie (forjado)', async () => {
    const res = await request(app)
      .post('/api/admin/usuarios')
      .set('Cookie', [`vigiiap_token=${adminToken}`])
      .set('X-CSRF-Token', generateCsrfToken('token-de-otra-sesion'))
      .send(payload);
    expect(res.status).toBe(403);
    expect(adminService.crearUsuario).not.toHaveBeenCalled();
  });

  it('acepta la petición con el header X-CSRF-Token correcto', async () => {
    adminService.crearUsuario.mockResolvedValue({ id: 'u-new', ...payload });
    const res = await request(app)
      .post('/api/admin/usuarios')
      .set('Cookie', [`vigiiap_token=${adminToken}`])
      .set('X-CSRF-Token', generateCsrfToken(adminToken))
      .send(payload);
    expect(res.status).toBe(201);
    expect(adminService.crearUsuario).toHaveBeenCalled();
  });

  it('clientes Bearer (sin cookie) no necesitan token CSRF — comportamiento preexistente intacto', async () => {
    adminService.crearUsuario.mockResolvedValue({ id: 'u-new', ...payload });
    const res = await request(app)
      .post('/api/admin/usuarios')
      .set('Authorization', `Bearer ${adminToken}`)
      .send(payload);
    expect(res.status).toBe(201);
  });
});

describe('GET /api/admin/stats — método seguro, no exige token CSRF', () => {
  it('funciona con cookie de sesión y sin header X-CSRF-Token', async () => {
    const res = await request(app)
      .get('/api/admin/stats')
      .set('Cookie', [`vigiiap_token=${adminToken}`]);
    expect(res.status).toBe(200);
  });
});
