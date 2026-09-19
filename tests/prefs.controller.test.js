import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../src/modules/notificaciones/prefs.service.js', () => ({
  obtener: vi.fn(), actualizar: vi.fn(),
}));

import * as prefsService from '../src/modules/notificaciones/prefs.service.js';
import { index, update } from '../src/modules/notificaciones/prefs.controller.js';

const USER = { id: 'u1', email: 'u@iiap.org.co', rol: 'investigador' };

function mockRes() {
  return { status: vi.fn().mockReturnThis(), json: vi.fn().mockReturnThis() };
}
const mockNext = vi.fn();

beforeEach(() => vi.clearAllMocks());

describe('index()', () => {
  it('devuelve las preferencias del usuario autenticado', async () => {
    prefsService.obtener.mockResolvedValue([{ clave: 'nuevo_usuario', en_pantalla: true }]);
    const res = mockRes();
    await index({ user: USER }, res, mockNext);
    expect(prefsService.obtener).toHaveBeenCalledWith('u1', 'investigador');
    expect(res.json).toHaveBeenCalledWith({ data: [{ clave: 'nuevo_usuario', en_pantalla: true }] });
  });
});

describe('update()', () => {
  it('valida enPantalla como booleano y actualiza', async () => {
    prefsService.actualizar.mockResolvedValue();
    const res = mockRes();
    await update({ params: { clave: 'nuevo_usuario' }, body: { enPantalla: false }, user: USER }, res, mockNext);
    expect(prefsService.actualizar).toHaveBeenCalledWith('u1', 'nuevo_usuario', false);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ message: expect.any(String) }));
  });

  it('llama next(err) si enPantalla no es booleano', async () => {
    await update({ params: { clave: 'x' }, body: { enPantalla: 'si' }, user: USER }, mockRes(), mockNext);
    expect(mockNext).toHaveBeenCalledWith(expect.any(Error));
    expect(prefsService.actualizar).not.toHaveBeenCalled();
  });

  it('llama next(err) ante error del servicio (ej. 404)', async () => {
    prefsService.actualizar.mockRejectedValue(Object.assign(new Error('no encontrado'), { status: 404 }));
    await update({ params: { clave: 'x' }, body: { enPantalla: true }, user: USER }, mockRes(), mockNext);
    expect(mockNext).toHaveBeenCalledWith(expect.objectContaining({ status: 404 }));
  });
});
