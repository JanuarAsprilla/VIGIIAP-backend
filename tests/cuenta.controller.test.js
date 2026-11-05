import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../src/config/database.js', () => ({ query: vi.fn(), getClient: vi.fn() }));
vi.mock('../src/modules/privacidad/cuenta.service.js', () => ({
  exportarMisDatos: vi.fn(),
  eliminarMiCuenta: vi.fn(),
}));
// La sesión simulada es de un usuario SIN rol verificado: el contraste con PATCH /me prueba que authorize() sí se aplica donde corresponde.
vi.mock('../src/middlewares/auth.js', async (importarOriginal) => ({
  ...(await importarOriginal()),
  authenticate: (req, _res, next) => { req.user = { id: 'u1', email: 'ana@iiap.test', rol: 'publico' }; next(); },
}));
vi.mock('../src/utils/auditLog.js', () => ({ registrarAuditoria: vi.fn() }));
vi.mock('../src/utils/tokenBlacklist.js', () => ({
  revokeToken: vi.fn().mockResolvedValue(undefined),
  isRevoked: vi.fn().mockReturnValue(false),
}));
vi.mock('../src/utils/logger.js', () => ({
  default: { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() },
}));

import request from 'supertest';
import express from 'express';
import { exportarMisDatos, eliminarMiCuenta } from '../src/modules/privacidad/cuenta.service.js';
import { registrarAuditoria } from '../src/utils/auditLog.js';
import { revokeToken } from '../src/utils/tokenBlacklist.js';
import { exportar, eliminar } from '../src/modules/privacidad/cuenta.controller.js';
import usuariosRouter from '../src/modules/usuarios/usuarios.routes.js';
import { csrfProtection } from '../src/middlewares/csrf.js';

const res = () => ({
  status: vi.fn().mockReturnThis(), json: vi.fn(), setHeader: vi.fn(), clearCookie: vi.fn(),
});
const USER = { id: 'u1', email: 'ana@iiap.test', exp: 1_900_000_000 };

describe('exportar()', () => {
  beforeEach(() => vi.resetAllMocks());

  it('entrega los datos como descarga, sin caché, y deja constancia de la exportación', async () => {
    exportarMisDatos.mockResolvedValue({ cuenta: { id: 'u1' } });
    const r = res();

    await exportar({ user: USER, ip: '10.0.0.1' }, r, vi.fn());

    expect(r.setHeader).toHaveBeenCalledWith('Content-Disposition', 'attachment; filename="mis-datos-vigiiap.json"');
    expect(r.setHeader).toHaveBeenCalledWith('Cache-Control', 'no-store');
    expect(r.json).toHaveBeenCalledWith({ cuenta: { id: 'u1' } });
    expect(registrarAuditoria).toHaveBeenCalledWith(expect.objectContaining({ accion: 'export_datos_propios', usuarioId: 'u1' }));
  });

  it('propaga el error al manejador si el servicio falla', async () => {
    const err = Object.assign(new Error('no existe'), { status: 404 });
    exportarMisDatos.mockRejectedValue(err);
    const next = vi.fn();
    await exportar({ user: USER }, res(), next);
    expect(next).toHaveBeenCalledWith(err);
  });
});

describe('eliminar()', () => {
  beforeEach(() => vi.resetAllMocks());
  const pedir = (body) => ({ user: USER, ip: '10.0.0.1', body, cookies: { vigiiap_token: 'jwt-actual' }, headers: {} });

  it('elimina la cuenta, revoca el token en uso y limpia las cookies de sesión', async () => {
    eliminarMiCuenta.mockResolvedValue({ eliminada: true });
    const r = res();

    await eliminar(pedir({ confirmacion: 'ELIMINAR', password: 'Clave-123' }), r, vi.fn());

    expect(eliminarMiCuenta).toHaveBeenCalledWith({ usuarioId: 'u1', confirmacion: 'ELIMINAR', password: 'Clave-123' });
    expect(revokeToken).toHaveBeenCalledWith('jwt-actual', USER.exp);
    expect(r.clearCookie).toHaveBeenCalledWith('vigiiap_token', expect.any(Object));
    expect(r.clearCookie).toHaveBeenCalledWith('vigiiap_refresh', expect.any(Object));
    expect(r.json).toHaveBeenCalledWith({ message: expect.stringContaining('eliminada') });
  });

  it('la auditoría de la eliminación no guarda el correo ni el nombre', async () => {
    eliminarMiCuenta.mockResolvedValue({ eliminada: true });
    await eliminar(pedir({ confirmacion: 'ELIMINAR' }), res(), vi.fn());
    const evento = registrarAuditoria.mock.calls[0][0];
    expect(evento).toMatchObject({ accion: 'cuenta_eliminada', usuarioId: 'u1' });
    expect(evento.usuarioEmail).toBeUndefined();
    expect(JSON.stringify(evento)).not.toContain('ana@iiap.test');
  });

  it('un cuerpo inválido (sin frase o contraseña enorme) se rechaza sin llegar al servicio', async () => {
    for (const body of [{}, { confirmacion: 'x'.repeat(41) }, { confirmacion: 'ELIMINAR', password: 'p'.repeat(73) }]) {
      const next = vi.fn();
      await eliminar(pedir(body), res(), next);
      expect(next).toHaveBeenCalledWith(expect.objectContaining({ name: 'ZodError' }));
    }
    expect(eliminarMiCuenta).not.toHaveBeenCalled();
  });

  it('si el servicio rechaza, no revoca el token ni toca las cookies', async () => {
    const err = Object.assign(new Error('Contraseña incorrecta'), { status: 401 });
    eliminarMiCuenta.mockRejectedValue(err);
    const r = res();
    const next = vi.fn();

    await eliminar(pedir({ confirmacion: 'ELIMINAR', password: 'mala' }), r, next);

    expect(next).toHaveBeenCalledWith(err);
    expect(revokeToken).not.toHaveBeenCalled();
    expect(r.clearCookie).not.toHaveBeenCalled();
    expect(registrarAuditoria).not.toHaveBeenCalled();
  });
});

describe('rutas de los derechos del titular', () => {
  const rutaDe = (ruta, metodo) => usuariosRouter.stack.find((l) => l.route?.path === ruta && l.route.methods[metodo]).route.stack.map((s) => s.handle);

  it('DELETE /me exige sesión y CSRF', () => {
    const manejadores = rutaDe('/me', 'delete');
    expect(manejadores).toContain(csrfProtection);
    expect(manejadores.at(-1)).toBe(eliminar);
  });

  it('GET /me/datos vale para cualquier rol, incluido «publico»', async () => {
    exportarMisDatos.mockResolvedValue({ cuenta: { id: 'u1' } });
    const app = express();
    app.use(express.json());
    app.use('/usuarios', usuariosRouter);

    const r = await request(app).get('/usuarios/me/datos');

    expect(r.status).toBe(200);
    expect(r.body).toEqual({ cuenta: { id: 'u1' } });
  });

  it('en cambio PATCH /me (editar perfil) sigue reservado a roles verificados', async () => {
    const app = express();
    app.use(express.json());
    app.use('/usuarios', usuariosRouter);
    const r = await request(app).patch('/usuarios/me').send({ nombre: 'Ana' });
    expect(r.status).toBe(403);
  });
});
