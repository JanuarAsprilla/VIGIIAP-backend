import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../src/config/database.js', () => ({
  query: vi.fn(),
  getClient: vi.fn(),
  connectDB: vi.fn(),
  default: { end: vi.fn() },
}));
vi.mock('../src/utils/tokenBlacklist.js', () => ({
  isRevoked: vi.fn().mockReturnValue(false),
  revokeToken: vi.fn(),
  loadBlacklist: vi.fn(),
  revokeAllRefreshTokens: vi.fn(),
}));
vi.mock('../src/utils/logger.js', () => ({
  default: { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() },
}));

import request from 'supertest';
import { comprobarListo, marcarApagando, reiniciarSalud } from '../src/utils/salud.js';
import { query } from '../src/config/database.js';
import app from '../src/app.js';

const TIMEOUT_MS = 50;
const redisSano = { isReady: true, ping: vi.fn().mockResolvedValue('PONG') };

function deps(extra = {}) {
  return {
    consultarBd: vi.fn().mockResolvedValue({ rows: [] }),
    clienteRedis: () => redisSano,
    redisConfigurado: true,
    redisObligatorio: false,
    timeoutMs: TIMEOUT_MS,
    cacheMs: 0,
    ...extra,
  };
}

const nunca = () => new Promise(() => {});

describe('comprobarListo()', () => {
  beforeEach(() => { reiniciarSalud(); vi.clearAllMocks(); });

  it('listo cuando la BD y Redis responden', async () => {
    const r = await comprobarListo(deps());
    expect(r).toEqual({ listo: true, cuerpo: { status: 'ready', db: 'ok', redis: 'ok' } });
  });

  it('no listo (503) cuando la BD falla, sin exponer el error', async () => {
    const r = await comprobarListo(deps({ consultarBd: vi.fn().mockRejectedValue(new Error('password authentication failed for user "postgres" at 10.0.0.5')) }));
    expect(r.listo).toBe(false);
    expect(r.cuerpo).toEqual({ status: 'not_ready', db: 'unreachable', redis: 'ok' });
    expect(JSON.stringify(r)).not.toMatch(/password|postgres|10\.0\.0\.5/);
  });

  it('un pool de BD saturado (la consulta no responde) se corta por timeout y no queda listo', async () => {
    const inicio = Date.now();
    const r = await comprobarListo(deps({ consultarBd: vi.fn(nunca) }));
    expect(r.listo).toBe(false);
    expect(r.cuerpo.db).toBe('unreachable');
    expect(Date.now() - inicio).toBeLessThan(1000);
  });

  it('Redis caído no saca la instancia del balanceador por defecto (la API tolera la caída)', async () => {
    const r = await comprobarListo(deps({ clienteRedis: () => ({ isReady: false }) }));
    expect(r).toEqual({ listo: true, cuerpo: { status: 'ready', db: 'ok', redis: 'unreachable' } });
  });

  it('Redis sin respuesta se corta por timeout', async () => {
    const r = await comprobarListo(deps({ clienteRedis: () => ({ isReady: true, ping: vi.fn(nunca) }) }));
    expect(r.cuerpo.redis).toBe('unreachable');
    expect(r.listo).toBe(true);
  });

  it('con READY_REDIS_OBLIGATORIO, Redis caído deja la instancia no lista', async () => {
    const r = await comprobarListo(deps({ redisObligatorio: true, clienteRedis: () => ({ isReady: false }) }));
    expect(r.listo).toBe(false);
    expect(r.cuerpo.status).toBe('not_ready');
  });

  it('sin REDIS_URL reporta not_configured y no lo exige', async () => {
    const r = await comprobarListo(deps({ redisConfigurado: false, redisObligatorio: true }));
    expect(r).toEqual({ listo: true, cuerpo: { status: 'ready', db: 'ok', redis: 'not_configured' } });
  });

  it('al apagar (SIGTERM) deja de estar listo para que el balanceador drene la instancia', async () => {
    marcarApagando();
    const r = await comprobarListo(deps());
    expect(r).toEqual({ listo: false, cuerpo: { status: 'draining' } });
  });

  it('comparte una sola comprobación entre llamadas simultáneas y la reutiliza durante cacheMs', async () => {
    const consultarBd = vi.fn().mockResolvedValue({ rows: [] });
    const d = deps({ consultarBd, cacheMs: 1000 });
    await Promise.all([comprobarListo(d), comprobarListo(d), comprobarListo(d)]);
    await comprobarListo(d);
    expect(consultarBd).toHaveBeenCalledTimes(1);
  });
});

describe('rutas /health/ready y /health/live', () => {
  const REDIS = process.env.REDIS_URL;
  beforeEach(() => { reiniciarSalud(); vi.clearAllMocks(); delete process.env.REDIS_URL; });
  afterEach(() => { if (REDIS !== undefined) process.env.REDIS_URL = REDIS; reiniciarSalud(); });

  it('GET /health/ready responde 200 con BD sana, sin versión ni uptime ni detalles', async () => {
    query.mockResolvedValue({ rows: [] });
    const res = await request(app).get('/health/ready');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ready', db: 'ok', redis: 'not_configured' });
    expect(res.headers['cache-control']).toMatch(/no-store/);
  });

  it('GET /health/ready responde 503 con la BD caída', async () => {
    query.mockRejectedValue(new Error('ECONNREFUSED'));
    const res = await request(app).get('/health/ready');
    expect(res.status).toBe(503);
    expect(res.body).toEqual({ status: 'not_ready', db: 'unreachable', redis: 'not_configured' });
  });

  it('GET /health/live responde 200 sin consultar ninguna dependencia', async () => {
    const res = await request(app).get('/health/live');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok' });
    expect(query).not.toHaveBeenCalled();
  });

  it('GET /health sigue existiendo', async () => {
    query.mockResolvedValue({ rows: [] });
    const res = await request(app).get('/health');
    expect([200, 503]).toContain(res.status);
    expect(res.body).toHaveProperty('status');
  });
});
