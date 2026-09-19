import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../src/modules/notificaciones/notificaciones.service.js', () => ({
  listar: vi.fn(),
  marcarLeida: vi.fn(),
  marcarTodasLeidas: vi.fn(),
}));

import * as notificacionesService from '../src/modules/notificaciones/notificaciones.service.js';
import { index, marcarLeida, marcarTodasLeidas } from '../src/modules/notificaciones/notificaciones.controller.js';

const USER = { id: 'user-1', email: 'user@iiap.org.co', rol: 'investigador' };
const NOTIF_ID = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';

function mockRes() {
  return { status: vi.fn().mockReturnThis(), json: vi.fn().mockReturnThis() };
}
const mockNext = vi.fn();

beforeEach(() => vi.clearAllMocks());

describe('index()', () => {
  it('devuelve las notificaciones del usuario autenticado', async () => {
    notificacionesService.listar.mockResolvedValue([{ id: 'n1' }]);
    const res = mockRes();

    await index({ user: USER }, res, mockNext);

    expect(notificacionesService.listar).toHaveBeenCalledWith('user-1');
    expect(res.json).toHaveBeenCalledWith({ data: [{ id: 'n1' }] });
  });

  it('llama next(err) ante error del servicio', async () => {
    notificacionesService.listar.mockRejectedValue(new Error('db fail'));
    await index({ user: USER }, mockRes(), mockNext);
    expect(mockNext).toHaveBeenCalledWith(expect.any(Error));
  });
});

describe('marcarLeida()', () => {
  it('retorna 400 si el id no es un UUID válido', async () => {
    const req = { params: { id: 'no-es-uuid' }, user: USER };
    const res = mockRes();

    await marcarLeida(req, res, mockNext);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(notificacionesService.marcarLeida).not.toHaveBeenCalled();
  });

  it('marca como leída y responde 200 cuando pertenece al usuario', async () => {
    notificacionesService.marcarLeida.mockResolvedValue(true);
    const req = { params: { id: NOTIF_ID }, user: USER };
    const res = mockRes();

    await marcarLeida(req, res, mockNext);

    expect(notificacionesService.marcarLeida).toHaveBeenCalledWith(NOTIF_ID, 'user-1');
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ message: expect.any(String) }));
  });

  it('retorna 404 si no existe o no pertenece al usuario', async () => {
    notificacionesService.marcarLeida.mockResolvedValue(false);
    const req = { params: { id: NOTIF_ID }, user: USER };
    const res = mockRes();

    await marcarLeida(req, res, mockNext);

    expect(res.status).toHaveBeenCalledWith(404);
  });

  it('llama next(err) ante error del servicio', async () => {
    notificacionesService.marcarLeida.mockRejectedValue(new Error('db fail'));
    await marcarLeida({ params: { id: NOTIF_ID }, user: USER }, mockRes(), mockNext);
    expect(mockNext).toHaveBeenCalledWith(expect.any(Error));
  });
});

describe('marcarTodasLeidas()', () => {
  it('responde con la cantidad marcada', async () => {
    notificacionesService.marcarTodasLeidas.mockResolvedValue(4);
    const res = mockRes();

    await marcarTodasLeidas({ user: USER }, res, mockNext);

    expect(notificacionesService.marcarTodasLeidas).toHaveBeenCalledWith('user-1');
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ message: expect.stringContaining('4') }));
  });

  it('llama next(err) ante error del servicio', async () => {
    notificacionesService.marcarTodasLeidas.mockRejectedValue(new Error('db fail'));
    await marcarTodasLeidas({ user: USER }, mockRes(), mockNext);
    expect(mockNext).toHaveBeenCalledWith(expect.any(Error));
  });
});
