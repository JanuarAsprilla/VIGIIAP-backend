import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

vi.mock('../src/modules/biodiversidad/biodiversidad.service.js', () => ({
  estado: vi.fn(),
  municipios: vi.fn(),
  registros: vi.fn(),
}));
vi.mock('../src/modules/herramientas/herramientas.service.js', () => ({
  herramientaDisponible: vi.fn(),
}));
vi.mock('../src/middlewares/cache.js', () => ({
  cacheMiddleware: () => (_req, _res, next) => next(),
  invalidateCache: vi.fn(),
  getRedisClient: vi.fn(() => null),
}));
vi.mock('../src/middlewares/rateLimiter.js', () => ({
  biodiversidadRateLimiter: (_req, _res, next) => next(),
}));
vi.mock('../src/config/database.js', () => ({ query: vi.fn(), getClient: vi.fn() }));
vi.mock('../src/utils/logger.js', () => ({
  default: { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() },
}));
vi.mock('../src/utils/errorTracking.js', () => ({ registrarError: vi.fn() }));

import * as servicio from '../src/modules/biodiversidad/biodiversidad.service.js';
import { herramientaDisponible } from '../src/modules/herramientas/herramientas.service.js';
import { ConsultaInvalida } from '../src/modules/biodiversidad/biodiversidad.errores.js';
import biodiversidadRoutes from '../src/modules/biodiversidad/biodiversidad.routes.js';
import { errorHandler } from '../src/middlewares/errorHandler.js';

function crearApp() {
  const app = express();
  app.use('/api/biodiversidad', biodiversidadRoutes);
  app.use(errorHandler);
  return app;
}

const app = crearApp();

beforeEach(() => {
  vi.clearAllMocks();
  herramientaDisponible.mockResolvedValue(true);
});

describe('interruptor de la herramienta', () => {
  it.each([
    '/api/biodiversidad/estado',
    '/api/biodiversidad/municipios?grupo=anfibios',
    '/api/biodiversidad/registros?grupo=anfibios',
  ])('responde 404 en %s cuando la herramienta no está disponible', async (ruta) => {
    herramientaDisponible.mockResolvedValue(false);
    const res = await request(app).get(ruta);
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'Recurso no encontrado' });
    expect(servicio.estado).not.toHaveBeenCalled();
    expect(servicio.municipios).not.toHaveBeenCalled();
    expect(servicio.registros).not.toHaveBeenCalled();
  });

  it('consulta el interruptor con la clave de la herramienta', async () => {
    servicio.estado.mockResolvedValue({ grupos: [] });
    await request(app).get('/api/biodiversidad/estado');
    expect(herramientaDisponible).toHaveBeenCalledWith('biodiversidad', undefined);
  });

  it('si no se puede consultar el interruptor falla cerrado (500), nunca abierto', async () => {
    herramientaDisponible.mockRejectedValue(new Error('bd caída'));
    const res = await request(app).get('/api/biodiversidad/estado');
    expect(res.status).toBe(500);
    expect(servicio.estado).not.toHaveBeenCalled();
  });
});

describe('GET /estado', () => {
  it('devuelve el estado del servicio', async () => {
    servicio.estado.mockResolvedValue({ grupos: [{ grupo: 'anfibios' }], conservacion: { activa: true } });
    const res = await request(app).get('/api/biodiversidad/estado');
    expect(res.status).toBe(200);
    expect(res.body.grupos).toEqual([{ grupo: 'anfibios' }]);
  });
});

describe('GET /municipios', () => {
  it('valida el grupo (422)', async () => {
    const res = await request(app).get('/api/biodiversidad/municipios?grupo=dinosaurios');
    expect(res.status).toBe(422);
    expect(servicio.municipios).not.toHaveBeenCalled();
  });

  it('devuelve 404 si el grupo no tiene datos cargados', async () => {
    servicio.municipios.mockResolvedValue(null);
    const res = await request(app).get('/api/biodiversidad/municipios?grupo=hongos');
    expect(res.status).toBe(404);
  });

  it('devuelve el resumen por municipio', async () => {
    servicio.municipios.mockResolvedValue({ grupo: 'hongos', municipios: [] });
    const res = await request(app).get('/api/biodiversidad/municipios?grupo=hongos');
    expect(res.status).toBe(200);
    expect(servicio.municipios).toHaveBeenCalledWith('hongos');
  });
});

describe('GET /registros', () => {
  it('rechaza parámetros no declarados (422) sin tocar el servicio', async () => {
    const res = await request(app).get('/api/biodiversidad/registros?grupo=aves&orden=x');
    expect(res.status).toBe(422);
    expect(servicio.registros).not.toHaveBeenCalled();
  });

  it('rechaza paginación demasiado profunda (422)', async () => {
    const res = await request(app).get('/api/biodiversidad/registros?grupo=aves&tamano=100&pagina=101');
    expect(res.status).toBe(422);
  });

  it('pasa filtros ya validados y convertidos al servicio', async () => {
    servicio.registros.mockResolvedValue({ registros: [], total: 0 });
    const res = await request(app).get('/api/biodiversidad/registros?grupo=anfibios&anio_desde=2010&pagina=2&tamano=10');
    expect(res.status).toBe(200);
    expect(servicio.registros).toHaveBeenCalledWith({ grupo: 'anfibios', anio_desde: 2010, pagina: 2, tamano: 10 });
  });

  it('devuelve 404 si el grupo no tiene datos cargados', async () => {
    servicio.registros.mockResolvedValue(null);
    const res = await request(app).get('/api/biodiversidad/registros?grupo=hongos');
    expect(res.status).toBe(404);
  });

  it('traduce una consulta inválida de negocio a su código (422) con mensaje claro', async () => {
    servicio.registros.mockRejectedValue(new ConsultaInvalida('Este grupo solo tiene inventario agregado'));
    const res = await request(app).get('/api/biodiversidad/registros?grupo=aves');
    expect(res.status).toBe(422);
    expect(res.body.error).toMatch(/inventario agregado/);
  });

  it('traduce el tiempo límite de la consulta (57014) a 503 sin exponer detalles de la BD', async () => {
    servicio.registros.mockRejectedValue(Object.assign(new Error('canceling statement due to statement timeout'), { code: '57014' }));
    const res = await request(app).get('/api/biodiversidad/registros?grupo=anfibios');
    expect(res.status).toBe(503);
    expect(JSON.stringify(res.body)).not.toMatch(/statement|timeout/i);
  });
});
