import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import app from '../src/app.js';

vi.mock('../src/config/database.js', () => ({
  query: vi.fn(),
  getClient: vi.fn(),
}));
vi.mock('../src/config/dynamicConfig.js', async (importOriginal) => ({
  ...(await importOriginal()),
  getRequire2faAdmins: vi.fn(),
}));
vi.mock('../src/modules/auth/auth.service.js', async (importOriginal) => ({
  ...(await importOriginal()),
  getProfile: vi.fn().mockResolvedValue({ id: 'admin-sin-2fa', rol: 'admin_sig', require2FA: true, twoFactorEnabled: false }),
}));

import { query } from '../src/config/database.js';
import { getRequire2faAdmins } from '../src/config/dynamicConfig.js';
import { olvidarEstado2fa } from '../src/utils/politica2fa.js';

const token = (id, rol) => jwt.sign({ id, email: `${id}@iiap.test`, rol }, process.env.JWT_SECRET);
const sinDosFactores = token('admin-sin-2fa', 'admin_sig');
const conDosFactores = token('admin-con-2fa', 'admin_sig');
const superSinDosFactores = token('super-sin-2fa', 'super_admin');

function consultas(sql, params = []) {
  if (/SELECT totp_enabled FROM usuarios/.test(sql)) {
    return Promise.resolve({ rows: [{ totp_enabled: params[0] === 'admin-con-2fa' }] });
  }
  if (/admin_permisos_modulo/.test(sql)) return Promise.resolve({ rows: [{ puede_ver: true, puede_editar: true }] });
  return Promise.resolve({ rows: [{ count: '1' }] });
}

describe('política «exigir 2FA a administradores» en la API', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    for (const id of ['admin-sin-2fa', 'admin-con-2fa', 'super-sin-2fa']) olvidarEstado2fa(id);
    query.mockImplementation(consultas);
  });

  describe('política activa', () => {
    beforeEach(() => getRequire2faAdmins.mockResolvedValue(true));

    it('un admin_sig sin TOTP recibe 403 con código estable 2FA_REQUIRED en rutas administrativas', async () => {
      const res = await request(app).get('/api/admin/stats').set('Authorization', `Bearer ${sinDosFactores}`);

      expect(res.status).toBe(403);
      expect(res.body.code).toBe('2FA_REQUIRED');
    });

    it('un super_admin sin TOTP también queda bloqueado', async () => {
      const res = await request(app).get('/api/admin/stats').set('Authorization', `Bearer ${superSinDosFactores}`);

      expect(res.status).toBe(403);
      expect(res.body.code).toBe('2FA_REQUIRED');
    });

    it('un admin_sig con TOTP opera con normalidad', async () => {
      const res = await request(app).get('/api/admin/stats').set('Authorization', `Bearer ${conDosFactores}`);

      expect(res.status).toBe(200);
    });

    it('el admin sin TOTP sigue pudiendo ver su perfil y obtener el token CSRF para activar el 2FA', async () => {
      const me = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${sinDosFactores}`);
      const csrf = await request(app).get('/api/auth/csrf-token').set('Cookie', `vigiiap_token=${sinDosFactores}`);

      expect(me.status).toBe(200);
      expect(csrf.status).toBe(200);
    });

    it('los roles no administrativos no se ven afectados', async () => {
      const res = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${token('inv-1', 'investigador')}`);

      expect(res.status).not.toBe(403);
    });
  });

  describe('política apagada', () => {
    beforeEach(() => getRequire2faAdmins.mockResolvedValue(false));

    it('el admin sin TOTP opera con normalidad y no se consulta su estado de 2FA', async () => {
      const res = await request(app).get('/api/admin/stats').set('Authorization', `Bearer ${sinDosFactores}`);

      expect(res.status).toBe(200);
      expect(query.mock.calls.some(([sql]) => /SELECT totp_enabled FROM usuarios/.test(sql))).toBe(false);
    });
  });
});
