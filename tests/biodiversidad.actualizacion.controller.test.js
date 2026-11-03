import { describe, it, expect, vi, beforeEach } from 'vitest';

const servicio = vi.hoisted(() => ({
  TAREAS: ['fotos', 'frescura', 'datos'],
  estado: vi.fn(), listarEjecuciones: vi.fn(), actualizarAjustes: vi.fn(),
  guardarCredencial: vi.fn(), borrarCredencial: vi.fn(), solicitar: vi.fn(),
}));
const auditoria = vi.hoisted(() => vi.fn());
vi.mock('../src/modules/biodiversidad/actualizacion/actualizacion.service.js', () => servicio);
vi.mock('../src/utils/auditLog.js', () => ({ registrarAuditoria: auditoria }));

import * as c from '../src/modules/biodiversidad/actualizacion/actualizacion.controller.js';

const UUID_A = '11111111-1111-4111-8111-111111111111';
const UUID_B = '22222222-2222-4222-8222-222222222222';
const resp = () => {
  const r = { statusCode: 200 };
  r.status = vi.fn((s) => { r.statusCode = s; return r; });
  r.json = vi.fn(() => r);
  r.end = vi.fn(() => r);
  return r;
};
const peticion = (extra = {}) => ({ user: { id: UUID_A, rol: 'admin_sig', email: 'a@x.co' }, ip: '1.1.1.1', body: {}, query: {}, ...extra });

beforeEach(() => { Object.values(servicio).forEach((f) => f.mockReset?.()); auditoria.mockReset(); });

describe('ver / ejecuciones', () => {
  it('ver entrega el estado y sabe si es super administrador', async () => {
    servicio.estado.mockResolvedValue({ ajustes: {} });
    const res = resp();
    await c.ver(peticion({ user: { id: UUID_A, rol: 'super_admin' } }), res, vi.fn());
    expect(servicio.estado).toHaveBeenCalledWith({ usuarioId: UUID_A, esSuperAdmin: true });
    expect(res.json).toHaveBeenCalledWith({ ajustes: {} });
  });

  it('ejecuciones pasa el límite y los errores llegan a next', async () => {
    servicio.listarEjecuciones.mockResolvedValue([{ id: 1 }]);
    const res = resp();
    await c.ejecuciones(peticion({ query: { limite: '5' } }), res, vi.fn());
    expect(servicio.listarEjecuciones).toHaveBeenCalledWith('5');
    expect(res.json).toHaveBeenCalledWith({ ejecuciones: [{ id: 1 }] });
    const falla = new Error('x'); servicio.estado.mockRejectedValue(falla);
    const next = vi.fn(); await c.ver(peticion(), resp(), next);
    expect(next).toHaveBeenCalledWith(falla);
  });
});

describe('cambiarAjustes', () => {
  it('valida el cuerpo (vacío, campo desconocido, frecuencia fuera de rango)', async () => {
    for (const body of [{}, { otro: 1 }, { frecuencia_dias: 3 }, { modo: 'raro' }]) {
      const res = resp();
      await c.cambiarAjustes(peticion({ body }), res, vi.fn());
      expect(res.status).toHaveBeenCalledWith(400);
    }
    expect(servicio.actualizarAjustes).not.toHaveBeenCalled();
  });

  it('guarda y audita el cambio de modo', async () => {
    servicio.actualizarAjustes.mockResolvedValue({ antes: { modo: 'publico', activa: true }, despues: { modo: 'cuenta', activa: true, frecuencia_dias: 15 } });
    const res = resp();
    await c.cambiarAjustes(peticion({ body: { modo: 'cuenta', credencial_usuario_id: UUID_B } }), res, vi.fn());
    expect(servicio.actualizarAjustes).toHaveBeenCalledWith(UUID_A, { modo: 'cuenta', credencial_usuario_id: UUID_B });
    expect(auditoria).toHaveBeenCalledWith(expect.objectContaining({ accion: 'update_biodiversidad_actualizacion', modulo: 'biodiversidad_datos' }));
    expect(res.json).toHaveBeenCalledWith({ ok: true });
  });
});

describe('credencial', () => {
  const cuerpo = { gbif_usuario: 'persona', gbif_correo: 'p@x.co', clave: 'clave-ficticia' };

  it('rechaza datos inválidos y no los pasa al servicio', async () => {
    for (const body of [{ ...cuerpo, gbif_correo: 'no-es-correo' }, { ...cuerpo, clave: '123' }, { ...cuerpo, extra: 1 }, { gbif_usuario: 'x' }]) {
      const res = resp();
      await c.guardarCredencial(peticion({ body }), res, vi.fn());
      expect(res.status).toHaveBeenCalledWith(400);
    }
    expect(servicio.guardarCredencial).not.toHaveBeenCalled();
  });

  it('guarda la propia sin registrar la clave en la auditoría', async () => {
    const res = resp();
    await c.guardarCredencial(peticion({ body: cuerpo }), res, vi.fn());
    expect(servicio.guardarCredencial).toHaveBeenCalledWith(UUID_A, expect.objectContaining(cuerpo));
    expect(JSON.stringify(auditoria.mock.calls)).not.toContain('clave-ficticia');
    expect(res.json).toHaveBeenCalledWith({ ok: true });
  });

  it('quien no es super administrador no puede gestionar la cuenta de otra persona', async () => {
    const res = resp();
    await c.guardarCredencial(peticion({ body: { ...cuerpo, usuario_id: UUID_B } }), res, vi.fn());
    expect(res.status).toHaveBeenCalledWith(403);
    expect(servicio.guardarCredencial).not.toHaveBeenCalled();
    const res2 = resp();
    await c.borrarCredencial(peticion({ query: { usuario_id: UUID_B } }), res2, vi.fn());
    expect(res2.status).toHaveBeenCalledWith(403);
    expect(servicio.borrarCredencial).not.toHaveBeenCalled();
  });

  it('el super administrador sí puede, y borrar responde 204', async () => {
    const res = resp();
    await c.guardarCredencial(peticion({ user: { id: UUID_A, rol: 'super_admin' }, body: { ...cuerpo, usuario_id: UUID_B } }), res, vi.fn());
    expect(servicio.guardarCredencial).toHaveBeenCalledWith(UUID_B, expect.anything());
    const res2 = resp();
    await c.borrarCredencial(peticion({ user: { id: UUID_A, rol: 'super_admin' }, query: { usuario_id: UUID_B } }), res2, vi.fn());
    expect(servicio.borrarCredencial).toHaveBeenCalledWith(UUID_B);
    expect(res2.status).toHaveBeenCalledWith(204);
  });

  it('borrar valida el usuario_id y propaga los errores del servicio', async () => {
    const res = resp();
    await c.borrarCredencial(peticion({ query: { usuario_id: 'no-uuid' } }), res, vi.fn());
    expect(res.status).toHaveBeenCalledWith(400);
    const falla = Object.assign(new Error('503'), { status: 503 });
    servicio.guardarCredencial.mockRejectedValue(falla);
    const next = vi.fn();
    await c.guardarCredencial(peticion({ body: cuerpo }), resp(), next);
    expect(next).toHaveBeenCalledWith(falla);
  });
});

describe('solicitar', () => {
  it('solo acepta tareas conocidas y responde 202 con la solicitud', async () => {
    const mala = resp();
    await c.solicitar(peticion({ body: { tarea: 'borrar-todo' } }), mala, vi.fn());
    expect(mala.status).toHaveBeenCalledWith(400);
    servicio.solicitar.mockResolvedValue({ id: 9, tarea: 'fotos', estado: 'solicitada' });
    const res = resp();
    await c.solicitar(peticion({ body: { tarea: 'fotos' } }), res, vi.fn());
    expect(servicio.solicitar).toHaveBeenCalledWith(UUID_A, 'fotos');
    expect(res.status).toHaveBeenCalledWith(202);
    expect(auditoria).toHaveBeenCalledWith(expect.objectContaining({ accion: 'create_biodiversidad_actualizacion', entidadId: '9' }));
  });

  it('un conflicto del servicio llega a next', async () => {
    const conflicto = Object.assign(new Error('ya'), { status: 409 });
    servicio.solicitar.mockRejectedValue(conflicto);
    const next = vi.fn();
    await c.solicitar(peticion({ body: { tarea: 'fotos' } }), resp(), next);
    expect(next).toHaveBeenCalledWith(conflicto);
  });
});
