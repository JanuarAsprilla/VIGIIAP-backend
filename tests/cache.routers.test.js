/**
 * Regresión del cache con Express real: dos routers montados con la misma ruta relativa ("/")
 * no pueden compartir entradas. En producción GET /api/v1/categorias devolvía el listado de
 * documentos porque ambas claves eran "cache:/:".
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import express, { Router } from 'express';
import request from 'supertest';

const almacen = new Map();
vi.mock('redis', () => ({
  createClient: vi.fn(() => ({
    isReady: true,
    on: vi.fn(),
    connect: vi.fn().mockResolvedValue(undefined),
    get: vi.fn(async (clave) => almacen.get(clave) ?? null),
    setEx: vi.fn(async (clave, _ttl, valor) => { almacen.set(clave, valor); return 'OK'; }),
    keys: vi.fn(async (patron) => {
      const prefijo = patron.replace(/\*$/, '');
      return [...almacen.keys()].filter((c) => c.startsWith(prefijo));
    }),
    del: vi.fn(async (claves) => { claves.forEach((c) => almacen.delete(c)); return claves.length; }),
  })),
}));
vi.mock('../src/utils/logger.js', () => ({
  default: { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() },
}));

import { cacheMiddleware, invalidarRecurso } from '../src/middlewares/cache.js';

function crearApp() {
  const documentos = Router();
  documentos.get('/', cacheMiddleware(60), (_req, res) => res.json({ data: [{ titulo: 'Un documento' }] }));
  documentos.get('/:slug', cacheMiddleware(60), (req, res) => (
    req.params.slug === 'existe' ? res.json({ slug: 'existe' }) : res.status(404).json({ error: 'No encontrado' })
  ));

  const categorias = Router();
  categorias.get('/', cacheMiddleware(60), (_req, res) => res.json([{ nombre: 'Bosques' }]));

  const v1 = Router();
  v1.use('/documentos', documentos);
  v1.use('/categorias', categorias);

  const app = express();
  app.use('/api/v1', v1);
  return app;
}

describe('cache con routers montados', () => {
  beforeEach(() => {
    almacen.clear();
    process.env.REDIS_URL = 'redis://localhost:6379';
  });

  it('el listado de categorías no devuelve el de documentos aunque este se haya cacheado primero', async () => {
    const app = crearApp();

    await request(app).get('/api/v1/documentos');
    const categorias = await request(app).get('/api/v1/categorias');

    expect(categorias.body).toEqual([{ nombre: 'Bosques' }]);
    expect(categorias.headers['x-cache']).toBe('MISS');
  });

  it('cada recurso tiene su propia entrada y la segunda lectura es un HIT del mismo recurso', async () => {
    const app = crearApp();

    await request(app).get('/api/v1/categorias');
    const segunda = await request(app).get('/api/v1/categorias');
    const documentos = await request(app).get('/api/v1/documentos');

    expect(segunda.headers['x-cache']).toBe('HIT');
    expect(segunda.body).toEqual([{ nombre: 'Bosques' }]);
    expect(documentos.body).toEqual({ data: [{ titulo: 'Un documento' }] });
  });

  it('un 404 no queda cacheado', async () => {
    const app = crearApp();

    const noExiste = await request(app).get('/api/v1/documentos/nuevo');

    expect(noExiste.status).toBe(404);
    expect([...almacen.keys()].some((c) => c.includes('/documentos/nuevo'))).toBe(false);
  });

  it('invalidarRecurso borra solo las entradas de ese recurso', async () => {
    const app = crearApp();
    await request(app).get('/api/v1/documentos');
    await request(app).get('/api/v1/categorias');

    await invalidarRecurso('documentos');

    const claves = [...almacen.keys()];
    expect(claves.some((c) => c.includes('/documentos'))).toBe(false);
    expect(claves.some((c) => c.includes('/categorias'))).toBe(true);
  });
});
