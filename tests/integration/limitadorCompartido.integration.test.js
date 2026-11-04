/**
 * Tests de integración — limitador de tráfico compartido entre instancias (Redis real).
 * Se omiten si no hay TEST_REDIS_URL. Cada «instancia» es un almacén y una app propios que
 * comparten el mismo Redis, como lo harían dos procesos del servicio.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import express from 'express';
import request from 'supertest';
import rateLimit from 'express-rate-limit';
import { createClient } from 'redis';
import { crearAlmacen } from '../../src/middlewares/almacenLimitador.js';

const URL_REDIS = process.env.TEST_REDIS_URL;
const pausa = (ms) => new Promise((resolver) => setTimeout(resolver, ms));

describe.skipIf(!URL_REDIS)('limitador compartido con Redis real', () => {
  let cliente;
  const nombre = `prueba_${Date.now()}`;

  beforeAll(async () => {
    cliente = createClient({ url: URL_REDIS });
    await cliente.connect();
  });

  afterAll(async () => {
    const claves = await cliente.keys('rl:prueba_*');
    if (claves.length) await cliente.del(claves);
    await cliente.quit();
  });

  function instancia(sufijo, { max = 3, windowMs = 60_000 } = {}) {
    const almacen = crearAlmacen(`${nombre}_${sufijo}`, { obtenerCliente: () => cliente });
    return { almacen, opciones: { windowMs, max, store: almacen, keyGenerator: () => 'misma-ip', standardHeaders: true, legacyHeaders: false, validate: false } };
  }

  /** Dos «instancias»: apps distintas, almacenes distintos, el mismo prefijo en Redis. */
  function dosInstancias(max) {
    const prefijo = `${nombre}_${Math.random().toString(36).slice(2, 8)}`;
    const crear = () => {
      const app = express();
      const almacen = crearAlmacen(prefijo, { obtenerCliente: () => cliente });
      app.use(rateLimit({ windowMs: 60_000, max, store: almacen, keyGenerator: () => 'misma-ip', validate: false }));
      app.get('/', (_req, res) => res.json({ ok: true }));
      return app;
    };
    return [crear(), crear()];
  }

  it('dos instancias comparten el contador: el límite vale para el conjunto, no por instancia', async () => {
    const [a, b] = dosInstancias(3);

    const estados = [];
    for (const app of [a, b, a, b, a]) estados.push((await request(app).get('/')).status);

    expect(estados).toEqual([200, 200, 200, 429, 429]);
  });

  it('sin compartir (memoria por instancia) el mismo tráfico habría pasado entero: la mejora es real', async () => {
    const crearEnMemoria = () => {
      const app = express();
      app.use(rateLimit({ windowMs: 60_000, max: 3, keyGenerator: () => 'misma-ip', validate: false }));
      app.get('/', (_req, res) => res.json({ ok: true }));
      return app;
    };
    const [a, b] = [crearEnMemoria(), crearEnMemoria()];

    const estados = [];
    for (const app of [a, b, a, b, a]) estados.push((await request(app).get('/')).status);

    expect(estados).toEqual([200, 200, 200, 200, 200]);
  });

  it('el conteo es atómico bajo concurrencia: 50 peticiones simultáneas dan 1..50 sin repetir', async () => {
    const [x, y] = [instancia('c1').almacen, instancia('c1').almacen];
    [x, y].forEach((a) => a.init({ windowMs: 60_000 }));

    const resultados = await Promise.all(
      Array.from({ length: 50 }, (_, i) => (i % 2 ? x : y).increment('clave')),
    );

    const cuentas = resultados.map((r) => r.totalHits).sort((m, n) => m - n);
    expect(cuentas).toEqual(Array.from({ length: 50 }, (_, i) => i + 1));
  });

  it('el contador siempre vence: nunca queda una clave permanente', async () => {
    const { almacen } = instancia('ttl');
    almacen.init({ windowMs: 60_000 });

    await almacen.increment('ip');

    const ttl = await cliente.pTTL(`rl:${nombre}_ttl:ip`);
    expect(ttl).toBeGreaterThan(0);
    expect(ttl).toBeLessThanOrEqual(60_000);
  });

  it('al terminar la ventana el contador vuelve a empezar', async () => {
    const { almacen } = instancia('ventana');
    almacen.init({ windowMs: 1_000 });
    await almacen.increment('ip');
    await almacen.increment('ip');

    await pausa(1_200);
    const r = await almacen.increment('ip');

    expect(r.totalHits).toBe(1);
  });

  it('resetKey reinicia el contador compartido', async () => {
    const { almacen } = instancia('reinicio');
    almacen.init({ windowMs: 60_000 });
    await almacen.increment('ip');
    await almacen.increment('ip');

    await almacen.resetKey('ip');

    expect((await almacen.increment('ip')).totalHits).toBe(1);
  });

  it('si el Redis configurado no está disponible, sigue limitando en memoria sin lanzar', async () => {
    const caido = createClient({ url: 'redis://127.0.0.1:1', socket: { reconnectStrategy: false } });
    caido.on('error', () => {});
    await caido.connect().catch(() => {});
    const almacen = crearAlmacen(`${nombre}_caido`, { obtenerCliente: () => caido });
    almacen.init({ windowMs: 60_000 });

    const cuentas = [];
    for (let i = 0; i < 3; i += 1) cuentas.push((await almacen.increment('ip')).totalHits);

    expect(cuentas).toEqual([1, 2, 3]);
  });
});
