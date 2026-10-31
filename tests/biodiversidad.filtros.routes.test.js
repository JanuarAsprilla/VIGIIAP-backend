import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

vi.mock('../src/modules/biodiversidad/biodiversidad.service.js', () => ({
  estado: vi.fn(), municipios: vi.fn(), registros: vi.fn(), registro: vi.fn(), resumen: vi.fn(), especies: vi.fn(), series: vi.fn(),
  puntos: vi.fn(), opciones: vi.fn(),
}));
vi.mock('../src/modules/herramientas/herramientas.service.js', () => ({ herramientaDisponible: vi.fn() }));
vi.mock('../src/middlewares/cache.js', () => ({
  cacheMiddleware: () => (_req, _res, next) => next(), invalidateCache: vi.fn(), getRedisClient: vi.fn(() => null),
}));
vi.mock('../src/middlewares/rateLimiter.js', () => ({ biodiversidadRateLimiter: (_req, _res, next) => next() }));
vi.mock('../src/config/database.js', () => ({ query: vi.fn(), getClient: vi.fn() }));
vi.mock('../src/utils/logger.js', () => ({ default: { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() } }));
vi.mock('../src/utils/errorTracking.js', () => ({ registrarError: vi.fn() }));

import * as servicio from '../src/modules/biodiversidad/biodiversidad.service.js';
import { herramientaDisponible } from '../src/modules/herramientas/herramientas.service.js';
import { ConsultaInvalida } from '../src/modules/biodiversidad/biodiversidad.errores.js';
import biodiversidadRoutes from '../src/modules/biodiversidad/biodiversidad.routes.js';
import { errorHandler } from '../src/middlewares/errorHandler.js';

const app = express();
app.use('/api/biodiversidad', biodiversidadRoutes);
app.use(errorHandler);
const get = (ruta) => request(app).get(`/api/biodiversidad${ruta}`);

beforeEach(() => {
  vi.clearAllMocks();
  herramientaDisponible.mockResolvedValue(true);
});

describe('interruptor en las rutas nuevas', () => {
  it.each(['/puntos?grupo=anfibios', '/opciones?grupo=anfibios&campo=clase'])('404 en %s con la herramienta apagada', async (ruta) => {
    herramientaDisponible.mockResolvedValue(false);
    const res = await get(ruta);
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'Recurso no encontrado' });
    expect(servicio.puntos).not.toHaveBeenCalled();
    expect(servicio.opciones).not.toHaveBeenCalled();
  });
});

describe('GET /puntos', () => {
  it('pasa los filtros validados al servicio (bbox numérico, límite por defecto)', async () => {
    servicio.puntos.mockResolvedValue({ grupo: 'anfibios', total: 0, mostrados: 0, ocultos: 0, muestreado: false, puntos: [] });
    const res = await get('/puntos?grupo=anfibios&clase=Amphibia&bbox=-77,5,-76,6');
    expect(res.status).toBe(200);
    expect(servicio.puntos).toHaveBeenCalledWith({ grupo: 'anfibios', clase: 'Amphibia', bbox: [-77, 5, -76, 6], limite: 1500 });
  });

  it('422 con bbox inválido, parámetros desconocidos o repetidos', async () => {
    for (const q of ['bbox=1,2,3', 'bbox=-76,5,-77,6', 'x=1', 'clase=Aa&clase=Bb', 'limite=5000']) {
      const res = await get(`/puntos?grupo=anfibios&${q}`);
      expect(res.status, q).toBe(422);
    }
    expect(servicio.puntos).not.toHaveBeenCalled();
  });

  it('ConsultaInvalida del servicio (grupo agregado) responde 422 con el mensaje', async () => {
    servicio.puntos.mockRejectedValue(new ConsultaInvalida('Este grupo solo tiene inventario agregado'));
    const res = await get('/puntos?grupo=aves');
    expect(res.status).toBe(422);
    expect(res.body.error).toMatch(/agregado/);
  });

  it('404 si el grupo no tiene datos', async () => {
    servicio.puntos.mockResolvedValue(null);
    expect((await get('/puntos?grupo=hongos')).status).toBe(404);
  });

  it('el servicio que falla con tiempo agotado responde 503', async () => {
    servicio.puntos.mockRejectedValue(Object.assign(new Error('x'), { code: '57014' }));
    expect((await get('/puntos?grupo=hongos')).status).toBe(503);
  });
});

describe('GET /opciones', () => {
  it('exige campo y pasa los filtros al servicio', async () => {
    servicio.opciones.mockResolvedValue({ grupo: 'anfibios', campo: 'familia', valores: [] });
    expect((await get('/opciones?grupo=anfibios')).status).toBe(422);
    const res = await get('/opciones?grupo=anfibios&campo=familia&orden=Anura&buscar=bufo');
    expect(res.status).toBe(200);
    expect(servicio.opciones).toHaveBeenCalledWith({ grupo: 'anfibios', campo: 'familia', orden_taxon: 'Anura', buscar: 'bufo', limite: 100 });
  });

  it('422 con campo desconocido o buscar con comodines', async () => {
    expect((await get('/opciones?grupo=anfibios&campo=sql')).status).toBe(422);
    expect((await get('/opciones?grupo=anfibios&campo=clase&buscar=%25%25')).status).toBe(422);
  });
});

describe('filtros comunes en las rutas existentes', () => {
  it.each(['municipios', 'resumen', 'series', 'especies', 'registros'])('/%s acepta la taxonomía y la reenvía al servicio', async (ruta) => {
    servicio[ruta].mockResolvedValue({ ok: true });
    const res = await get(`/${ruta}?grupo=anfibios&familia=Bufonidae&con_ubicacion=true&anio_desde=2000`);
    expect(res.status).toBe(200);
    expect(servicio[ruta]).toHaveBeenCalledWith(expect.objectContaining({ grupo: 'anfibios', familia: 'Bufonidae', con_ubicacion: true, anio_desde: 2000 }));
  });

  it('un 422 del servicio por reglas de agregados llega con su mensaje', async () => {
    servicio.resumen.mockRejectedValue(new ConsultaInvalida('no aplica a inventario agregado'));
    const res = await get('/resumen?grupo=aves&con_foto=true');
    expect(res.status).toBe(422);
    expect(res.body.error).toMatch(/no aplica/);
  });
});
