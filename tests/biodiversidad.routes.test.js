import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

vi.mock('../src/modules/biodiversidad/biodiversidad.service.js', () => ({
  estado: vi.fn(),
  municipios: vi.fn(),
  registros: vi.fn(),
  registro: vi.fn(),
  resumen: vi.fn(),
  especies: vi.fn(),
  series: vi.fn(),
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
    '/api/biodiversidad/registros/123?grupo=anfibios',
    '/api/biodiversidad/resumen?grupo=anfibios',
    '/api/biodiversidad/especies?grupo=anfibios',
    '/api/biodiversidad/series?grupo=anfibios',
  ])('responde 404 en %s cuando la herramienta no está disponible', async (ruta) => {
    herramientaDisponible.mockResolvedValue(false);
    const res = await request(app).get(ruta);
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'Recurso no encontrado' });
    expect(servicio.estado).not.toHaveBeenCalled();
    expect(servicio.municipios).not.toHaveBeenCalled();
    for (const f of ['registros', 'registro', 'resumen', 'especies', 'series']) expect(servicio[f]).not.toHaveBeenCalled();
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

describe('GET /registros — filtros nuevos', () => {
  it('pasa los filtros nuevos ya convertidos', async () => {
    servicio.registros.mockResolvedValue({ registros: [], total: 0 });
    await request(app).get('/api/biodiversidad/registros?grupo=hongos&buscar=amanita&con_foto=true&conservacion=endemica&amenaza=VU&especie_clave=77');
    expect(servicio.registros).toHaveBeenCalledWith({
      grupo: 'hongos', buscar: 'amanita', con_foto: true, conservacion: 'endemica', amenaza: 'VU', especie_clave: '77', pagina: 1, tamano: 25,
    });
  });

  it('rechaza valores inválidos sin tocar el servicio', async () => {
    for (const q of ['con_foto=false', 'amenaza=LC', 'buscar=a', 'especie_clave=1%27%20OR%201%3D1', 'buscar=ra&buscar=na']) {
      const res = await request(app).get(`/api/biodiversidad/registros?grupo=hongos&${q}`);
      expect(res.status, q).toBe(422);
    }
    expect(servicio.registros).not.toHaveBeenCalled();
  });
});

describe('GET /registros/:gbif_id', () => {
  it('devuelve el detalle', async () => {
    servicio.registro.mockResolvedValue({ gbif_id: '123', fotos: [] });
    const res = await request(app).get('/api/biodiversidad/registros/123?grupo=anfibios');
    expect(res.status).toBe(200);
    expect(servicio.registro).toHaveBeenCalledWith('123', 'anfibios');
  });

  it('404 si no existe el registro y 404 si el grupo no tiene datos', async () => {
    servicio.registro.mockResolvedValue(null);
    const res = await request(app).get('/api/biodiversidad/registros/123?grupo=anfibios');
    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/no encontrado/i);
  });

  it('valida el identificador y el grupo (422)', async () => {
    for (const ruta of ['/registros/abc?grupo=anfibios', '/registros/12%20OR%201?grupo=anfibios', '/registros/123', '/registros/123?grupo=dinos', '/registros/123?grupo=anfibios&x=1']) {
      expect((await request(app).get(`/api/biodiversidad${ruta}`)).status, ruta).toBe(422);
    }
    expect(servicio.registro).not.toHaveBeenCalled();
  });

  it('un grupo de inventario agregado responde 422 con mensaje claro', async () => {
    servicio.registro.mockRejectedValue(new ConsultaInvalida('Este grupo solo tiene inventario agregado'));
    const res = await request(app).get('/api/biodiversidad/registros/123?grupo=aves');
    expect(res.status).toBe(422);
  });
});

describe.each([
  ['resumen', 'resumen', '/resumen?grupo=aves&departamento=Choc%C3%B3', { grupo: 'aves', departamento: 'Chocó' }],
  ['series', 'series', '/series?grupo=plantas&codigo_municipal=27001', { grupo: 'plantas', codigo_municipal: '27001' }],
  ['especies', 'especies', '/especies?grupo=aves&buscar=tangara&orden=nombre', { grupo: 'aves', buscar: 'tangara', orden: 'nombre', pagina: 1, tamano: 25 }],
])('GET /%s', (_nombre, funcion, ruta, esperado) => {
  it('pasa los filtros validados al servicio', async () => {
    servicio[funcion].mockResolvedValue({ ok: true });
    const res = await request(app).get(`/api/biodiversidad${ruta}`);
    expect(res.status).toBe(200);
    expect(servicio[funcion]).toHaveBeenCalledWith(esperado);
  });

  it('404 si el grupo no tiene datos cargados', async () => {
    servicio[funcion].mockResolvedValue(null);
    expect((await request(app).get(`/api/biodiversidad${ruta}`)).status).toBe(404);
  });

  it('422 ante parámetros desconocidos o repetidos, sin tocar el servicio', async () => {
    const base = ruta.split('?')[0];
    expect((await request(app).get(`/api/biodiversidad${base}?grupo=aves&secreto=1`)).status).toBe(422);
    expect((await request(app).get(`/api/biodiversidad${base}?grupo=aves&grupo=hongos`)).status).toBe(422);
    expect((await request(app).get(`/api/biodiversidad${base}`)).status).toBe(422);
    expect(servicio[funcion]).not.toHaveBeenCalled();
  });

  it('503 sin detalle de la BD si la consulta supera el tiempo límite', async () => {
    servicio[funcion].mockRejectedValue(Object.assign(new Error('canceling statement due to statement timeout'), { code: '57014' }));
    const res = await request(app).get(`/api/biodiversidad${ruta}`);
    expect(res.status).toBe(503);
    expect(JSON.stringify(res.body)).not.toMatch(/statement|timeout/i);
  });
});

describe('GET /municipios — especies', () => {
  it('devuelve lo que entrega el servicio (con el nuevo campo especies)', async () => {
    servicio.municipios.mockResolvedValue({ grupo: 'aves', municipios: [{ codigo_municipal: '27001', registros: 5, sin_especie: 0, especies: 3 }] });
    const res = await request(app).get('/api/biodiversidad/municipios?grupo=aves');
    expect(res.body.municipios[0].especies).toBe(3);
  });
});
