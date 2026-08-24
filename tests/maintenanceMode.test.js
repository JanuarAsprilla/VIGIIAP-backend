import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../src/config/database.js', () => ({
  query: vi.fn(),
}));

vi.mock('../src/utils/logger.js', () => ({
  default: { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() },
}));

import { query } from '../src/config/database.js';
import {
  maintenanceGate,
  loadMaintenanceState,
  setMaintenanceState,
} from '../src/middlewares/maintenanceMode.js';

function mockRes() {
  return {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
  };
}
const mockNext = vi.fn();

describe('maintenanceGate() — síncrono, en memoria', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setMaintenanceState({ modoMantenimiento: false, mensajeMantenimiento: '' });
  });

  it('deja pasar sin tocar BD si el usuario es admin_sig, aunque esté activo', () => {
    setMaintenanceState({ modoMantenimiento: true });
    const req = { user: { rol: 'admin_sig' } };
    const res = mockRes();
    maintenanceGate(req, res, mockNext);
    expect(mockNext).toHaveBeenCalledOnce();
    expect(query).not.toHaveBeenCalled();
  });

  it('deja pasar sin tocar BD si el usuario es super_admin, aunque esté activo', () => {
    setMaintenanceState({ modoMantenimiento: true });
    const req = { user: { rol: 'super_admin' } };
    const res = mockRes();
    maintenanceGate(req, res, mockNext);
    expect(mockNext).toHaveBeenCalledOnce();
  });

  it('deja pasar a un visitante cuando el modo mantenimiento está desactivado (default)', () => {
    const req = {};
    const res = mockRes();
    maintenanceGate(req, res, mockNext);
    expect(mockNext).toHaveBeenCalledOnce();
    expect(res.status).not.toHaveBeenCalled();
    expect(query).not.toHaveBeenCalled();
  });

  it('bloquea con 503 a un visitante cuando el modo mantenimiento está activado', () => {
    setMaintenanceState({ modoMantenimiento: true, mensajeMantenimiento: 'Volvemos pronto.' });
    const req = {};
    const res = mockRes();
    maintenanceGate(req, res, mockNext);
    expect(mockNext).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(503);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ maintenance: true, error: 'Volvemos pronto.' })
    );
  });

  it('bloquea también a un usuario verificado no-admin (investigador) durante el mantenimiento', () => {
    setMaintenanceState({ modoMantenimiento: true });
    const req = { user: { rol: 'investigador' } };
    const res = mockRes();
    maintenanceGate(req, res, mockNext);
    expect(mockNext).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(503);
  });

  it('usa un mensaje por defecto si mensajeMantenimiento está vacío', () => {
    setMaintenanceState({ modoMantenimiento: true, mensajeMantenimiento: '' });
    const req = {};
    const res = mockRes();
    maintenanceGate(req, res, mockNext);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ error: expect.stringContaining('mantenimiento') })
    );
  });

  it('el cambio de estado se aplica de inmediato, sin esperar reinicio', () => {
    const req = {};
    const res1 = mockRes();
    maintenanceGate(req, res1, mockNext);
    expect(res1.status).not.toHaveBeenCalled();

    setMaintenanceState({ modoMantenimiento: true });
    const res2 = mockRes();
    maintenanceGate(req, res2, mockNext);
    expect(res2.status).toHaveBeenCalledWith(503);
  });
});

describe('loadMaintenanceState() — hidrata desde BD al arrancar', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setMaintenanceState({ modoMantenimiento: false, mensajeMantenimiento: '' });
  });

  it('carga activo=true y el mensaje configurado desde BD', async () => {
    query.mockResolvedValueOnce({
      rows: [
        { clave: 'modoMantenimiento', valor: 'true' },
        { clave: 'mensajeMantenimiento', valor: 'En mantenimiento programado.' },
      ],
    });
    await loadMaintenanceState();

    const req = {};
    const res = mockRes();
    maintenanceGate(req, res, mockNext);
    expect(res.status).toHaveBeenCalledWith(503);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ error: 'En mantenimiento programado.' })
    );
  });

  it('no lanza ni bloquea si la BD falla al cargar — asume desactivado', async () => {
    query.mockRejectedValueOnce(new Error('DB fail'));
    await expect(loadMaintenanceState()).resolves.toBeUndefined();

    const req = {};
    const res = mockRes();
    maintenanceGate(req, res, mockNext);
    expect(mockNext).toHaveBeenCalledOnce();
  });
});
