/**
 * Regresión: la clave del cache solo incluye una lista blanca de parámetros (page, limit, q…), así que
 * las rutas de biodiversidad, que filtran por otros (grupo, departamento…), compartían entrada y se
 * servían datos de un grupo para otro. Se prueba con el cache REAL y un Redis simulado.
 */
import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest';
import express from 'express';
import request from 'supertest';

const almacen = new Map();
vi.mock('redis', () => ({
  createClient: vi.fn(() => ({
    isReady: true,
    on: vi.fn(),
    connect: vi.fn().mockResolvedValue(undefined),
    get: vi.fn(async (clave) => almacen.get(clave) ?? null),
    setEx: vi.fn(async (clave, _ttl, valor) => { almacen.set(clave, valor); return 'OK'; }),
  })),
}));
vi.mock('../src/modules/biodiversidad/biodiversidad.service.js', () => ({
  estado: vi.fn(),
  municipios: vi.fn(),
  registros: vi.fn(),
}));
vi.mock('../src/modules/herramientas/herramientas.service.js', () => ({
  herramientaDisponible: vi.fn().mockResolvedValue(true),
}));
vi.mock('../src/middlewares/rateLimiter.js', () => ({
  biodiversidadRateLimiter: (_req, _res, next) => next(),
}));
vi.mock('../src/config/database.js', () => ({ query: vi.fn(), getClient: vi.fn() }));
vi.mock('../src/utils/logger.js', () => ({
  default: { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() },
}));

import * as servicio from '../src/modules/biodiversidad/biodiversidad.service.js';
import biodiversidadRoutes from '../src/modules/biodiversidad/biodiversidad.routes.js';

const app = express();
app.use('/api/biodiversidad', biodiversidadRoutes);

beforeAll(() => { process.env.REDIS_URL = 'redis://prueba'; });
beforeEach(() => {
  almacen.clear();
  vi.clearAllMocks();
});

describe('cache de las rutas de biodiversidad', () => {
  it('/municipios no mezcla grupos distintos', async () => {
    servicio.municipios.mockImplementation(async (grupo) => ({ grupo, municipios: [] }));
    const aves = await request(app).get('/api/biodiversidad/municipios?grupo=aves');
    const hongos = await request(app).get('/api/biodiversidad/municipios?grupo=hongos');
    expect(aves.body.grupo).toBe('aves');
    expect(hongos.body.grupo).toBe('hongos');
  });

  it('/registros no mezcla filtros ni páginas distintas', async () => {
    servicio.registros.mockImplementation(async (f) => ({ pagina: f.pagina, departamento: f.departamento ?? null, registros: [] }));
    const p1 = await request(app).get('/api/biodiversidad/registros?grupo=anfibios&pagina=1&tamano=10');
    const p2 = await request(app).get('/api/biodiversidad/registros?grupo=anfibios&pagina=2&tamano=10');
    const choco = await request(app).get('/api/biodiversidad/registros?grupo=anfibios&departamento=Choc%C3%B3');
    expect(p1.body.pagina).toBe(1);
    expect(p2.body.pagina).toBe(2);
    expect(choco.body.departamento).toBe('Chocó');
  });

  it('/estado, que no tiene parámetros, sí puede servirse desde cache', async () => {
    servicio.estado.mockResolvedValue({ grupos: [] });
    await request(app).get('/api/biodiversidad/estado');
    const segunda = await request(app).get('/api/biodiversidad/estado');
    expect(segunda.headers['x-cache']).toBe('HIT');
    expect(servicio.estado).toHaveBeenCalledTimes(1);
  });
});
