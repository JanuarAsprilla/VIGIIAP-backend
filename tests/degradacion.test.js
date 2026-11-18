import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import express from 'express';
import request from 'supertest';

vi.mock('../src/utils/logger.js', () => ({
  default: { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() },
}));

import logger from '../src/utils/logger.js';
import {
  clasificarRuta, siguienteNivel, crearDegradacion, leerConfigDegradacion, middlewareDegradacion, detenerDegradacion, NIVEL,
} from '../src/middlewares/degradacion.js';

const CONFIG = {
  retrasoNoCriticoMs: 200, retrasoTodoMs: 1000, enVueloNoCritico: 400, enVueloTodo: 1500,
  retryAfterS: 5, intervaloMs: 1000, histeresis: 0.7,
};

describe('clasificarRuta()', () => {
  it.each([
    ['GET', '/health'], ['GET', '/health/ready'], ['GET', '/api/v1/estado'],
    ['POST', '/api/v1/auth/login'], ['POST', '/api/auth/refresh'], ['POST', '/api/v1/auth/logout'],
    ['GET', '/api/v1/auth/csrf-token'], ['POST', '/api/v1/auth/2fa/confirm'], ['GET', '/api/v1/oauth/google'],
  ])('%s %s es exenta: nunca se descarta', (metodo, ruta) => {
    expect(clasificarRuta(metodo, ruta)).toBe('exenta');
  });

  it.each([
    ['POST', '/api/v1/analitica/pageview'], ['POST', '/api/analitica/evento'],
    ['GET', '/api/v1/analitica/resumen'], ['GET', '/api/v1/admin/export/usuarios'], ['GET', '/api/v1/admin/audit'],
    ['GET', '/api/v1/admin/audit/resumen'], ['GET', '/api/v1/informes/biodiversidad/registros'], ['GET', '/api/v1/admin/reportes'],
  ])('%s %s es no crítica: se descarta primero', (metodo, ruta) => {
    expect(clasificarRuta(metodo, ruta)).toBe('no_critica');
  });

  it.each([
    ['GET', '/api/v1/mapas'], ['GET', '/api/v1/geovisores/rio'], ['POST', '/api/v1/solicitudes'],
    ['GET', '/api/v1/informes/configuracion/biodiversidad'], ['GET', '/api/v1/descargar/abc'],
  ])('%s %s es normal: solo se descarta en el último extremo', (metodo, ruta) => {
    expect(clasificarRuta(metodo, ruta)).toBe('normal');
  });

  it('una ruta que solo se parece a una exenta no se exime (/authors, /healthy)', () => {
    expect(clasificarRuta('GET', '/api/v1/authors')).toBe('normal');
    expect(clasificarRuta('GET', '/healthy')).toBe('normal');
  });
});

describe('siguienteNivel()', () => {
  const m = (retrasoMs, enVuelo = 0) => ({ retrasoMs, enVuelo });

  it('sube a degradado y a extremo al superar los umbrales de retraso o de peticiones en vuelo', () => {
    expect(siguienteNivel(NIVEL.NORMAL, m(50), CONFIG)).toBe(NIVEL.NORMAL);
    expect(siguienteNivel(NIVEL.NORMAL, m(250), CONFIG)).toBe(NIVEL.DEGRADADO);
    expect(siguienteNivel(NIVEL.NORMAL, m(10, 400), CONFIG)).toBe(NIVEL.DEGRADADO);
    expect(siguienteNivel(NIVEL.NORMAL, m(1200), CONFIG)).toBe(NIVEL.EXTREMO);
    expect(siguienteNivel(NIVEL.DEGRADADO, m(10, 1500), CONFIG)).toBe(NIVEL.EXTREMO);
  });

  it('histéresis: no sale del modo mientras la medida siga por encima del 70 % del umbral', () => {
    expect(siguienteNivel(NIVEL.DEGRADADO, m(150), CONFIG)).toBe(NIVEL.DEGRADADO);
    expect(siguienteNivel(NIVEL.DEGRADADO, m(100), CONFIG)).toBe(NIVEL.NORMAL);
    expect(siguienteNivel(NIVEL.EXTREMO, m(800), CONFIG)).toBe(NIVEL.EXTREMO);
    expect(siguienteNivel(NIVEL.EXTREMO, m(500), CONFIG)).toBe(NIVEL.DEGRADADO);
    expect(siguienteNivel(NIVEL.EXTREMO, m(50), CONFIG)).toBe(NIVEL.NORMAL);
  });
});

describe('leerConfigDegradacion()', () => {
  afterEach(() => { vi.unstubAllEnvs(); });

  it('usa los valores por defecto y acepta sobrescribirlos por entorno', () => {
    expect(leerConfigDegradacion({})).toMatchObject({ retrasoNoCriticoMs: 200, retrasoTodoMs: 1000, retryAfterS: 5 });
    expect(leerConfigDegradacion({ LOAD_SHED_RETRASO_NO_CRITICO_MS: '350', LOAD_SHED_RETRY_AFTER_S: '9' }))
      .toMatchObject({ retrasoNoCriticoMs: 350, retryAfterS: 9 });
  });

  it('un valor inválido conserva el default', () => {
    expect(leerConfigDegradacion({ LOAD_SHED_RETRASO_TODO_MS: 'abc', LOAD_SHED_EN_VUELO_TODO: '-3' }))
      .toMatchObject({ retrasoTodoMs: 1000, enVueloTodo: 1500 });
  });
});

function montar(retrasoMs) {
  const medidas = { retrasoMs };
  const degradacion = crearDegradacion({
    config: CONFIG, medirRetraso: () => medidas.retrasoMs, aleatorio: () => 0, iniciarTemporizador: false,
  });
  const app = express();
  app.get('/health', (_req, res) => res.json({ status: 'ok' }));
  app.use(degradacion.middleware);
  app.post('/api/v1/analitica/pageview', (_req, res) => res.status(204).end());
  app.get('/api/v1/admin/export/usuarios', (_req, res) => res.json([]));
  app.get('/api/v1/mapas', (_req, res) => res.json([]));
  app.post('/api/v1/auth/login', (_req, res) => res.json({ ok: true }));
  app.post('/api/v1/auth/refresh', (_req, res) => res.json({ ok: true }));
  return { app, degradacion, medidas };
}

describe('middleware de degradación', () => {
  beforeEach(() => vi.clearAllMocks());

  it('en carga normal no descarta nada', async () => {
    const { app, degradacion } = montar(20);
    degradacion.evaluar();
    expect((await request(app).post('/api/v1/analitica/pageview')).status).toBe(204);
    expect((await request(app).get('/api/v1/mapas')).status).toBe(200);
  });

  it('nivel degradado: 503 con Retry-After solo para lo no crítico', async () => {
    const { app, degradacion } = montar(300);
    degradacion.evaluar();
    const beacon = await request(app).post('/api/v1/analitica/pageview');
    expect(beacon.status).toBe(503);
    expect(beacon.headers['retry-after']).toBe('5');
    expect((await request(app).get('/api/v1/admin/export/usuarios')).status).toBe(503);
    expect((await request(app).get('/api/v1/mapas')).status).toBe(200);
  });

  it('nivel extremo: también descarta lo normal, pero nunca health, login ni refresh', async () => {
    const { app, degradacion } = montar(1500);
    degradacion.evaluar();
    const mapas = await request(app).get('/api/v1/mapas');
    expect(mapas.status).toBe(503);
    expect(mapas.headers['retry-after']).toBeDefined();
    expect((await request(app).get('/health')).status).toBe(200);
    expect((await request(app).post('/api/v1/auth/login')).status).toBe(200);
    expect((await request(app).post('/api/v1/auth/refresh')).status).toBe(200);
  });

  it('registra la entrada y la salida del modo, con el total de peticiones descartadas', async () => {
    const { app, degradacion, medidas } = montar(300);
    degradacion.evaluar();
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('ENTRA'));
    await request(app).post('/api/v1/analitica/pageview');
    await request(app).post('/api/v1/analitica/pageview');
    medidas.retrasoMs = 10;
    degradacion.evaluar();
    expect(logger.info).toHaveBeenCalledWith(expect.stringMatching(/SALE.*descartadas=2/));
    expect(degradacion.estado()).toMatchObject({ nivel: NIVEL.NORMAL });
  });

  it('cuenta las peticiones en vuelo y las libera al terminar', async () => {
    const { app, degradacion } = montar(10);
    await request(app).get('/api/v1/mapas');
    expect(degradacion.estado().enVuelo).toBe(0);
  });

  it('la ráfaga de peticiones en vuelo activa el modo aunque el bucle vaya bien', () => {
    const degradacion = crearDegradacion({
      config: { ...CONFIG, enVueloNoCritico: 2 }, medirRetraso: () => 0, aleatorio: () => 0, iniciarTemporizador: false,
    });
    const res = { once: vi.fn(), setHeader: vi.fn(), status: vi.fn().mockReturnThis(), json: vi.fn() };
    const next = vi.fn();
    degradacion.middleware({ method: 'GET', path: '/api/v1/mapas' }, res, next);
    degradacion.middleware({ method: 'GET', path: '/api/v1/mapas' }, res, next);
    degradacion.evaluar();
    expect(degradacion.estado().nivel).toBe(NIVEL.DEGRADADO);
  });
});

describe('activación por LOAD_SHEDDING', () => {
  afterEach(() => { vi.unstubAllEnvs(); detenerDegradacion(); });

  it('apagado por defecto: no hay middleware', () => {
    vi.stubEnv('LOAD_SHEDDING', '');
    expect(middlewareDegradacion()).toBeNull();
    vi.stubEnv('LOAD_SHEDDING', 'false');
    expect(middlewareDegradacion()).toBeNull();
  });

  it('con LOAD_SHEDDING=true devuelve un middleware y reutiliza la misma instancia', () => {
    vi.stubEnv('LOAD_SHEDDING', 'true');
    const primero = middlewareDegradacion();
    expect(typeof primero).toBe('function');
    expect(middlewareDegradacion()).toBe(primero);
  });
});
