import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import express from 'express';
import cookieParser from 'cookie-parser';
import request from 'supertest';

const cliente = vi.hoisted(() => ({
  isReady: true,
  on: vi.fn(),
  connect: vi.fn().mockResolvedValue(undefined),
  get: vi.fn().mockResolvedValue(null),
  setEx: vi.fn().mockResolvedValue('OK'),
  keys: vi.fn().mockResolvedValue([]),
  del: vi.fn().mockResolvedValue(1),
}));
vi.mock('redis', () => ({ createClient: vi.fn(() => cliente) }));
vi.mock('../src/utils/logger.js', () => ({
  default: { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() },
}));

import { cacheMiddleware } from '../src/middlewares/cache.js';

const TTL_REDIS = 120;

function crearApp({ usuario, respuesta } = {}) {
  const app = express();
  app.use(cookieParser());
  app.use((req, _res, next) => { if (usuario) req.user = usuario; next(); });
  app.get('/lista', cacheMiddleware(TTL_REDIS), (_req, res) => (respuesta ? respuesta(res) : res.json([{ id: 1 }])));
  return app;
}

const cabeceraVary = (res) => String(res.headers.vary ?? '');

describe('cabeceras de caché para CDN', () => {
  beforeEach(() => {
    process.env.REDIS_URL = 'redis://localhost:6379';
    process.env.CDN_CACHE_HEADERS = 'true';
    delete process.env.CDN_BROWSER_MAX_AGE_S;
    cliente.isReady = true;
    cliente.get.mockReset().mockResolvedValue(null);
    cliente.setEx.mockClear();
  });
  afterEach(() => { delete process.env.CDN_CACHE_HEADERS; delete process.env.CDN_BROWSER_MAX_AGE_S; });

  it('apagado por defecto: no emite Cache-Control ni Vary propios', async () => {
    delete process.env.CDN_CACHE_HEADERS;
    const res = await request(crearApp()).get('/lista');
    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toBeUndefined();
    expect(cabeceraVary(res)).not.toMatch(/Cookie/);
  });

  it('respuesta pública (MISS): public, max-age corto, s-maxage = TTL de Redis y Vary', async () => {
    const res = await request(crearApp()).get('/lista');
    expect(res.headers['x-cache']).toBe('MISS');
    expect(res.headers['cache-control']).toBe(`public, max-age=30, s-maxage=${TTL_REDIS}`);
    expect(cabeceraVary(res)).toMatch(/Cookie/);
    expect(cabeceraVary(res)).toMatch(/Authorization/);
  });

  it('respuesta pública servida desde Redis (HIT) lleva las mismas cabeceras', async () => {
    cliente.get.mockResolvedValue(JSON.stringify([{ id: 1 }]));
    const res = await request(crearApp()).get('/lista');
    expect(res.headers['x-cache']).toBe('HIT');
    expect(res.headers['cache-control']).toBe(`public, max-age=30, s-maxage=${TTL_REDIS}`);
  });

  it('sigue siendo pública si Redis no está disponible', async () => {
    cliente.isReady = false;
    const res = await request(crearApp()).get('/lista');
    expect(res.headers['cache-control']).toMatch(/^public, /);
  });

  it('CDN_BROWSER_MAX_AGE_S ajusta el max-age del navegador', async () => {
    process.env.CDN_BROWSER_MAX_AGE_S = '0';
    const res = await request(crearApp()).get('/lista');
    expect(res.headers['cache-control']).toBe(`public, max-age=0, s-maxage=${TTL_REDIS}`);
  });

  it('un valor inválido de CDN_BROWSER_MAX_AGE_S conserva el max-age por defecto', async () => {
    process.env.CDN_BROWSER_MAX_AGE_S = 'abc';
    const res = await request(crearApp()).get('/lista');
    expect(res.headers['cache-control']).toBe(`public, max-age=30, s-maxage=${TTL_REDIS}`);
  });

  describe('NUNCA public si la respuesta pudo depender de la persona', () => {
    const casos = [
      ['cookie de sesión', (r) => r.set('Cookie', 'vigiiap_token=jwt')],
      ['Authorization Bearer', (r) => r.set('Authorization', 'Bearer abc')],
      ['Authorization de otro esquema', (r) => r.set('Authorization', 'Basic dXNlcjpwYXNz')],
    ];
    it.each(casos)('con %s es private, no-store (y no toca Redis)', async (_nombre, conCredencial) => {
      const res = await conCredencial(request(crearApp()).get('/lista'));
      expect(res.headers['cache-control']).toBe('private, no-store');
      expect(res.headers['cache-control']).not.toMatch(/public/);
      expect(cabeceraVary(res)).toMatch(/Cookie/);
      expect(cabeceraVary(res)).toMatch(/Authorization/);
      expect(cliente.get).not.toHaveBeenCalled();
      expect(cliente.setEx).not.toHaveBeenCalled();
    });

    it('con un usuario ya resuelto (rol/visibilidad) sin cookie visible es private, no-store', async () => {
      const res = await request(crearApp({ usuario: { id: 'u1', rol: 'admin_sig' } })).get('/lista');
      expect(res.headers['cache-control']).toBe('private, no-store');
    });

    it('una respuesta con error (404) nunca es public', async () => {
      const res = await request(crearApp({ respuesta: (r) => r.status(404).json({ error: 'no existe' }) })).get('/lista');
      expect(res.status).toBe(404);
      expect(res.headers['cache-control']).toBe('private, no-store');
    });

    it('una respuesta que fija una cookie nunca es public', async () => {
      const res = await request(crearApp({ respuesta: (r) => { r.cookie('x', '1'); return r.json({ ok: true }); } })).get('/lista');
      expect(res.headers['cache-control']).toBe('private, no-store');
    });

    it('si el controlador ya fijó su Cache-Control, se respeta', async () => {
      const res = await request(crearApp({ respuesta: (r) => { r.setHeader('Cache-Control', 'no-cache'); return r.json([]); } })).get('/lista');
      expect(res.headers['cache-control']).toBe('no-cache');
    });
  });
});
