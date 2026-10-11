import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../src/utils/auditLog.js', () => ({ registrarAuditoria: vi.fn() }));

import { registrarAuditoria } from '../src/utils/auditLog.js';
import { registrarAccesoDenegado, reiniciarAccesosDenegados } from '../src/utils/accesoDenegado.js';

const req = (extra = {}) => ({
  method: 'GET', originalUrl: '/api/v1/admin/x?q=1', ip: '1.2.3.4',
  user: { id: 'u1', email: 'u@iiap.org' }, headers: { 'user-agent': 'UA' }, ...extra,
});

describe('registrarAccesoDenegado()', () => {
  beforeEach(() => { vi.clearAllMocks(); reiniciarAccesosDenegados(); vi.useFakeTimers(); });
  afterEach(() => vi.useRealTimers());

  it('registra el evento con resultado denegado y sin la query string', () => {
    registrarAccesoDenegado(req(), 'rol insuficiente');
    expect(registrarAuditoria).toHaveBeenCalledWith(expect.objectContaining({
      accion: 'acceso_denegado', modulo: 'seguridad', resultado: 'denegado', usuarioId: 'u1', ip: '1.2.3.4',
      descripcion: expect.stringContaining('/api/v1/admin/x —'),
    }));
    expect(registrarAuditoria.mock.calls[0][0].descripcion).not.toContain('q=1');
  });

  it('no repite el evento para la misma ruta dentro de la ventana y sí después', () => {
    registrarAccesoDenegado(req(), 'm');
    registrarAccesoDenegado(req(), 'm');
    expect(registrarAuditoria).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(61_000);
    registrarAccesoDenegado(req(), 'm');
    expect(registrarAuditoria).toHaveBeenCalledTimes(2);
  });

  it('distingue usuarios y rutas, y usa la IP si no hay sesión', () => {
    registrarAccesoDenegado(req(), 'm');
    registrarAccesoDenegado(req({ user: { id: 'u2' } }), 'm');
    registrarAccesoDenegado(req({ originalUrl: '/otra' }), 'm');
    registrarAccesoDenegado(req({ user: undefined }), 'm');
    expect(registrarAuditoria).toHaveBeenCalledTimes(4);
    expect(registrarAuditoria.mock.calls[3][0].usuarioId).toBeNull();
  });

  it('mantiene la memoria acotada con muchas rutas distintas', () => {
    for (let i = 0; i < 5_100; i += 1) registrarAccesoDenegado(req({ originalUrl: `/r/${i}` }), 'm');
    expect(registrarAuditoria).toHaveBeenCalledTimes(5_100);
  });
});
