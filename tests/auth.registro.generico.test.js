import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../src/modules/auth/auth.service.js', () => ({
  register: vi.fn(),
  igualarTiempoDeRegistro: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../src/utils/mailer.js', () => ({
  notifyVerificacionEmail: vi.fn().mockResolvedValue(undefined),
  notifyAdminNewRegistro: vi.fn().mockResolvedValue(undefined),
  notifyIntentoRegistroExistente: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../src/modules/admin/admin.service.js', () => ({ getAdminEmails: vi.fn().mockResolvedValue([]) }));
vi.mock('../src/utils/configFlags.js', () => ({ notificacionHabilitada: vi.fn().mockResolvedValue(false) }));
vi.mock('../src/utils/passwordPolicy.js', async (importar) => ({
  ...(await importar()),
  validarLongitudMinima: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../src/modules/notificaciones/notificaciones.service.js', () => ({ notificarAdmins: vi.fn() }));
vi.mock('../src/utils/tokenBlacklist.js', () => ({ revokeToken: vi.fn(), isRevoked: vi.fn(), loadBlacklist: vi.fn() }));
vi.mock('../src/config/database.js', () => ({ query: vi.fn().mockResolvedValue({ rows: [] }), getClient: vi.fn() }));
vi.mock('../src/utils/logger.js', () => ({ default: { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() } }));
vi.mock('../src/utils/auditLog.js', () => ({ registrarAuditoria: vi.fn() }));

import * as authService from '../src/modules/auth/auth.service.js';
import * as mailer from '../src/utils/mailer.js';
import { register } from '../src/modules/auth/auth.controller.js';

const cuerpo = (email) => ({ nombre: 'Ana Pérez', email, password: 'Clave-Segura-123!', institucion: 'IIAP' });
const res = () => ({ status: vi.fn().mockReturnThis(), json: vi.fn().mockReturnThis() });
const conflicto = (code) => Object.assign(new Error('conflicto'), { status: 409, code });
const MENSAJE = 'Revisa tu correo electrónico para verificar tu cuenta.';

beforeEach(() => vi.clearAllMocks());

describe('registro — respuesta que no delata si el correo existe', () => {
  it('un registro nuevo responde 201 con el mensaje y el usuario creado', async () => {
    authService.register.mockResolvedValue({ id: 'u1', nombre: 'Ana Pérez', email: 'nuevo@x.co', verificationToken: 't' });
    const r = res();
    await register({ body: cuerpo('nuevo@x.co'), headers: {} }, r, vi.fn());
    expect(r.status).toHaveBeenCalledWith(201);
    expect(r.json).toHaveBeenCalledWith({ message: MENSAJE, user: { id: 'u1', nombre: 'Ana Pérez', email: 'nuevo@x.co' } });
    expect(authService.igualarTiempoDeRegistro).not.toHaveBeenCalled();
  });

  it('un correo ya registrado responde igual (201, mismo mensaje y forma), iguala el tiempo y avisa al dueño', async () => {
    authService.register.mockRejectedValue(conflicto('EMAIL_ALREADY_REGISTERED'));
    const r = res();
    const next = vi.fn();
    await register({ body: cuerpo('Existente@X.co'), headers: {} }, r, next);
    expect(next).not.toHaveBeenCalled();
    expect(r.status).toHaveBeenCalledWith(201);
    const [cuerpoRespuesta] = r.json.mock.calls[0];
    expect(cuerpoRespuesta.message).toBe(MENSAJE);
    expect(Object.keys(cuerpoRespuesta.user).sort()).toEqual(['email', 'id', 'nombre']);
    expect(cuerpoRespuesta.user.email).toBe('existente@x.co');
    expect(cuerpoRespuesta.user.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(authService.igualarTiempoDeRegistro).toHaveBeenCalledWith('Clave-Segura-123!');
    expect(mailer.notifyIntentoRegistroExistente).toHaveBeenCalledWith({ email: 'existente@x.co' });
  });

  it('no llena de avisos a un tercero: solo uno por dirección y hora', async () => {
    authService.register.mockRejectedValue(conflicto('EMAIL_ALREADY_REGISTERED'));
    for (let i = 0; i < 4; i += 1) await register({ body: cuerpo('victima@x.co'), headers: {} }, res(), vi.fn());
    expect(mailer.notifyIntentoRegistroExistente).toHaveBeenCalledTimes(1);
  });

  it('un registro en curso también responde igual, sin enviar ningún aviso', async () => {
    authService.register.mockRejectedValue(conflicto('EMAIL_VERIFICATION_PENDING'));
    const r = res();
    await register({ body: cuerpo('pendiente@x.co'), headers: {} }, r, vi.fn());
    expect(r.status).toHaveBeenCalledWith(201);
    expect(r.json.mock.calls[0][0].message).toBe(MENSAJE);
    expect(mailer.notifyIntentoRegistroExistente).not.toHaveBeenCalled();
  });

  it('cualquier otro error sigue su camino normal (no se disfraza de éxito)', async () => {
    const otro = Object.assign(new Error('otro conflicto'), { status: 409 });
    authService.register.mockRejectedValueOnce(otro);
    const next = vi.fn();
    await register({ body: cuerpo('a@x.co'), headers: {} }, res(), next);
    expect(next).toHaveBeenCalledWith(otro);
    authService.register.mockRejectedValueOnce(new Error('BD caída'));
    const next2 = vi.fn();
    await register({ body: cuerpo('b@x.co'), headers: {} }, res(), next2);
    expect(next2).toHaveBeenCalledWith(expect.objectContaining({ message: 'BD caída' }));
  });

  it('una petición inválida sigue fallando por validación, sin llegar al servicio', async () => {
    const next = vi.fn();
    await register({ body: {}, headers: {} }, res(), next);
    expect(next).toHaveBeenCalledWith(expect.any(Error));
    expect(authService.register).not.toHaveBeenCalled();
  });
});
