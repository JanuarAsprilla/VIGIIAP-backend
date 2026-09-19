import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../src/modules/notificaciones/tiposNotificacion.service.js', () => ({
  listar: vi.fn(), crear: vi.fn(), actualizar: vi.fn(), desactivar: vi.fn(),
}));
vi.mock('../src/utils/auditLog.js', () => ({ registrarAuditoria: vi.fn() }));

import * as tiposService from '../src/modules/notificaciones/tiposNotificacion.service.js';
import { index, create, update, destroy } from '../src/modules/notificaciones/tiposNotificacion.controller.js';

const ADMIN = { id: 'a1', email: 'admin@iiap.org.co', rol: 'super_admin' };
const REGULAR = { id: 'u1', email: 'u@iiap.org.co', rol: 'investigador' };

function mockRes() {
  return { status: vi.fn().mockReturnThis(), json: vi.fn().mockReturnThis(), end: vi.fn().mockReturnThis() };
}
const mockNext = vi.fn();

beforeEach(() => vi.clearAllMocks());

describe('index()', () => {
  it('pide solo activos cuando el usuario no es admin', async () => {
    tiposService.listar.mockResolvedValue([]);
    await index({ query: {}, user: REGULAR }, mockRes(), mockNext);
    expect(tiposService.listar).toHaveBeenCalledWith({ soloActivos: true });
  });

  it('pide todos cuando ?admin=true y el rol es super_admin', async () => {
    tiposService.listar.mockResolvedValue([]);
    await index({ query: { admin: 'true' }, user: ADMIN }, mockRes(), mockNext);
    expect(tiposService.listar).toHaveBeenCalledWith({ soloActivos: false });
  });

  it('ignora ?admin=true si el rol no es admin_sig/super_admin', async () => {
    tiposService.listar.mockResolvedValue([]);
    await index({ query: { admin: 'true' }, user: REGULAR }, mockRes(), mockNext);
    expect(tiposService.listar).toHaveBeenCalledWith({ soloActivos: true });
  });
});

describe('create()', () => {
  it('valida el body con zod y crea el tipo', async () => {
    tiposService.crear.mockResolvedValue({ clave: 'anuncio' });
    const res = mockRes();
    await create({ body: { clave: 'anuncio', nombre: 'Anuncio' }, user: ADMIN }, res, mockNext);
    expect(tiposService.crear).toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(201);
  });

  it('llama next(err) si el body es inválido', async () => {
    await create({ body: { clave: 'X' }, user: ADMIN }, mockRes(), mockNext);
    expect(mockNext).toHaveBeenCalledWith(expect.any(Error));
    expect(tiposService.crear).not.toHaveBeenCalled();
  });
});

describe('update()', () => {
  it('actualiza y responde 200', async () => {
    tiposService.actualizar.mockResolvedValue({ clave: 'nuevo_usuario', nombre: 'Nuevo nombre' });
    const res = mockRes();
    await update({ params: { clave: 'nuevo_usuario' }, body: { nombre: 'Nuevo nombre' }, user: ADMIN }, res, mockNext);
    expect(res.json).toHaveBeenCalledWith({ clave: 'nuevo_usuario', nombre: 'Nuevo nombre' });
  });

  it('llama next(err) ante error del servicio (ej. 404)', async () => {
    tiposService.actualizar.mockRejectedValue(Object.assign(new Error('no encontrado'), { status: 404 }));
    await update({ params: { clave: 'x' }, body: { nombre: 'Nombre válido' }, user: ADMIN }, mockRes(), mockNext);
    expect(mockNext).toHaveBeenCalledWith(expect.objectContaining({ status: 404 }));
  });
});

describe('destroy()', () => {
  it('desactiva y responde 204', async () => {
    tiposService.desactivar.mockResolvedValue();
    const res = mockRes();
    await destroy({ params: { clave: 'nuevo_usuario' }, user: ADMIN }, res, mockNext);
    expect(tiposService.desactivar).toHaveBeenCalledWith('nuevo_usuario');
    expect(res.status).toHaveBeenCalledWith(204);
  });
});
