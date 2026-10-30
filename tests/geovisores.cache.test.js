/**
 * Cada cambio en un geovisor debe vaciar el cache público del recurso: el listado y el detalle
 * se cachean 2 y 5 minutos, y sin invalidar el visitante seguía viendo el estado anterior.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../src/modules/geovisores/geovisores.service.js', () => ({
  create: vi.fn(),
  update: vi.fn(),
  getById: vi.fn(),
  remove: vi.fn(),
  toggleActivo: vi.fn(),
  updateThumbnail: vi.fn(),
}));
vi.mock('../src/modules/geovisores/geovisores.schema.js', () => ({
  createGeovisorSchema: { parse: (cuerpo) => cuerpo },
  updateGeovisorSchema: { parse: (cuerpo) => cuerpo },
  toggleGeovisorSchema: { parse: (cuerpo) => cuerpo },
}));
vi.mock('../src/utils/auditLog.js', () => ({ registrarAuditoria: vi.fn() }));
vi.mock('../src/middlewares/cache.js', () => ({
  invalidarRecurso: vi.fn().mockResolvedValue(undefined),
  cacheMiddleware: () => (_req, _res, next) => next(),
  getRedisClient: vi.fn(() => null),
}));

import * as geovisorService from '../src/modules/geovisores/geovisores.service.js';
import { invalidarRecurso } from '../src/middlewares/cache.js';
import { store, update, destroy, patchActivo, uploadThumbnail } from '../src/modules/geovisores/geovisores.controller.js';

const ADMIN = { id: 'a1', email: 'admin@iiap.org.co', rol: 'admin_sig' };
const GEOVISOR = { id: 'g1', titulo: 'Geología del Chocó' };

function mockRes() {
  return { status: vi.fn().mockReturnThis(), json: vi.fn().mockReturnThis(), send: vi.fn().mockReturnThis() };
}
const mockNext = vi.fn();

beforeEach(() => vi.clearAllMocks());

describe('geovisores → invalidación del cache público', () => {
  it('crear un geovisor vacía el cache de geovisores', async () => {
    geovisorService.create.mockResolvedValue(GEOVISOR);

    await store({ body: {}, user: ADMIN }, mockRes(), mockNext);

    expect(invalidarRecurso).toHaveBeenCalledWith('geovisores');
  });

  it('editar un geovisor vacía el cache de geovisores', async () => {
    geovisorService.getById.mockResolvedValue(GEOVISOR);
    geovisorService.update.mockResolvedValue(GEOVISOR);

    await update({ params: { id: 'g1' }, body: {}, user: ADMIN }, mockRes(), mockNext);

    expect(invalidarRecurso).toHaveBeenCalledWith('geovisores');
  });

  it('activar o desactivar un geovisor vacía el cache de geovisores', async () => {
    geovisorService.toggleActivo.mockResolvedValue({ ...GEOVISOR, activo: false });

    await patchActivo({ params: { id: 'g1' }, body: { activo: false }, user: ADMIN }, mockRes(), mockNext);

    expect(invalidarRecurso).toHaveBeenCalledWith('geovisores');
  });

  it('cambiar la miniatura vacía el cache de geovisores', async () => {
    geovisorService.updateThumbnail.mockResolvedValue(GEOVISOR);

    await uploadThumbnail({ params: { id: 'g1' }, body: { thumbnail_url: 'x' }, user: ADMIN }, mockRes(), mockNext);

    expect(invalidarRecurso).toHaveBeenCalledWith('geovisores');
  });

  it('eliminar un geovisor vacía el cache de geovisores', async () => {
    geovisorService.remove.mockResolvedValue(undefined);

    await destroy({ params: { id: 'g1' }, user: ADMIN }, mockRes(), mockNext);

    expect(invalidarRecurso).toHaveBeenCalledWith('geovisores');
  });

  it('si el servicio falla no invalida nada', async () => {
    geovisorService.remove.mockRejectedValue(new Error('no se pudo'));

    await destroy({ params: { id: 'g1' }, user: ADMIN }, mockRes(), mockNext);

    expect(invalidarRecurso).not.toHaveBeenCalled();
  });

  it('un fallo de Redis al invalidar no interrumpe la respuesta', async () => {
    geovisorService.remove.mockResolvedValue(undefined);
    invalidarRecurso.mockRejectedValueOnce(new Error('redis no disponible'));
    const res = mockRes();

    await destroy({ params: { id: 'g1' }, user: ADMIN }, res, mockNext);

    expect(res.status).toHaveBeenCalledWith(204);
    expect(mockNext).not.toHaveBeenCalled();
  });
});
