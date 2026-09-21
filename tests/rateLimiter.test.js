import { describe, it, expect } from 'vitest';
import express from 'express';
import request from 'supertest';
import {
  rateLimiter,
  authRateLimiter,
  twoFactorRateLimiter,
  loginAccountRateLimiter,
  uploadRateLimiter,
  downloadRateLimiter,
  adminRateLimiter,
  passwordResetLimiter,
  emailActionRateLimiter,
  tileRateLimiter,
} from '../src/middlewares/rateLimiter.js';

function buildApp(limiter, { withUser = false } = {}) {
  const app = express();
  app.use(express.json());
  if (withUser) {
    app.use((req, _res, next) => { req.user = { id: 'user-rl-1' }; next(); });
  }
  app.use(limiter);
  app.get('/ping', (_req, res) => res.status(200).json({ ok: true }));
  app.post('/ping', (_req, res) => res.status(200).json({ ok: true }));
  return app;
}

describe('rateLimiter — límite dinámico anónimo vs. autenticado', () => {
  it('usa la IP normalizada como key y el máximo por defecto (300) para anónimos', async () => {
    const app = buildApp(rateLimiter);
    const res = await request(app).get('/ping');

    expect(res.status).toBe(200);
    expect(res.headers['ratelimit-limit']).toBe('300');
  });

  it('usa req.user.id como key y el máximo elevado (500) para usuarios autenticados', async () => {
    const app = buildApp(rateLimiter, { withUser: true });
    const res = await request(app).get('/ping');

    expect(res.status).toBe(200);
    expect(res.headers['ratelimit-limit']).toBe('500');
  });
});

describe('authRateLimiter', () => {
  it('permite la petición y expone el límite estricto de autenticación (30)', async () => {
    const app = buildApp(authRateLimiter);
    const res = await request(app).get('/ping');

    expect(res.status).toBe(200);
    expect(res.headers['ratelimit-limit']).toBe('30');
  });

  // Regresión: ipKeyGenerator() de express-rate-limit v8 espera un STRING (req.ip),
  // no el objeto `req` completo. Pasarle `req` hace que cada petición reciba una key
  // distinta (el propio objeto req, único por request) y el Map interno del store
  // nunca acumula hits — el limiter jamás bloquea, sin importar cuántas peticiones
  // lleguen desde la misma IP. Este test falla si esa regresión reaparece.
  it('bloquea con 429 tras superar el límite desde la misma IP (normalizeIp debe usar req.ip, no req)', async () => {
    const app = buildApp(authRateLimiter);

    const statuses = [];
    for (let i = 0; i < 35; i++) {
      // eslint-disable-next-line no-await-in-loop
      const res = await request(app).get('/ping');
      statuses.push(res.status);
    }

    // Antes del fix: normalizeIp(req) devolvía el objeto `req` (único por petición)
    // en vez del string de IP, así que el store nunca acumulaba hits y esta
    // aserción fallaba con 0 bloqueos sin importar cuántas peticiones se enviaran.
    const blocked = statuses.filter((s) => s === 429).length;
    expect(blocked).toBeGreaterThan(0);
    expect(statuses[0]).toBe(200);
    // Una vez que empieza a bloquear, se mantiene bloqueado dentro de la ventana.
    const firstBlockedIdx = statuses.indexOf(429);
    expect(statuses.slice(firstBlockedIdx)).toEqual(
      Array(statuses.length - firstBlockedIdx).fill(429),
    );
  });
});

// Regresión: twoFactorRateLimiter debe quedarse en 10 aunque authRateLimiter
// suba — cada intento contra estos endpoints es una adivinanza directa de un
// código TOTP de 6 dígitos, no tráfico normal que se beneficie de más cupo
// por IP compartida.
describe('twoFactorRateLimiter — se mantiene estricto aunque authRateLimiter suba', () => {
  it('permite la petición y expone el límite estricto de verificación 2FA (10)', async () => {
    const app = buildApp(twoFactorRateLimiter);
    const res = await request(app).get('/ping');

    expect(res.status).toBe(200);
    expect(res.headers['ratelimit-limit']).toBe('10');
  });

  it('bloquea con 429 tras superar el límite desde la misma IP', async () => {
    const app = buildApp(twoFactorRateLimiter);

    const statuses = [];
    for (let i = 0; i < 15; i++) {
      // eslint-disable-next-line no-await-in-loop
      const res = await request(app).get('/ping');
      statuses.push(res.status);
    }

    const blocked = statuses.filter((s) => s === 429).length;
    expect(blocked).toBeGreaterThan(0);
    expect(statuses[0]).toBe(200);
    const firstBlockedIdx = statuses.indexOf(429);
    expect(statuses.slice(firstBlockedIdx)).toEqual(
      Array(statuses.length - firstBlockedIdx).fill(429),
    );
  });
});

describe('uploadRateLimiter', () => {
  it('permite la petición y expone el límite de subidas (10 por hora)', async () => {
    const app = buildApp(uploadRateLimiter);
    const res = await request(app).get('/ping');

    expect(res.status).toBe(200);
    expect(res.headers['ratelimit-limit']).toBe('10');
  });
});

describe('downloadRateLimiter', () => {
  it('permite la petición y expone el límite de descargas (60 por 5 min)', async () => {
    const app = buildApp(downloadRateLimiter);
    const res = await request(app).get('/ping');

    expect(res.status).toBe(200);
    expect(res.headers['ratelimit-limit']).toBe('60');
  });
});

describe('adminRateLimiter', () => {
  it('permite la petición y expone el límite administrativo (200 por 15 min)', async () => {
    const app = buildApp(adminRateLimiter);
    const res = await request(app).get('/ping');

    expect(res.status).toBe(200);
    expect(res.headers['ratelimit-limit']).toBe('200');
  });
});

describe('tileRateLimiter', () => {
  it('permite la petición y expone un cupo alto para tiles WMS/leyenda (600 por minuto)', async () => {
    const app = buildApp(tileRateLimiter);
    const res = await request(app).get('/ping');

    expect(res.status).toBe(200);
    expect(res.headers['ratelimit-limit']).toBe('600');
  });
});

// Regresión: un solo pan/zoom del visor de geovisores dispara decenas de
// peticiones a /wms y /leyenda en pocos segundos. Antes de este fix, esas
// peticiones compartían el cupo general (300/500 por 15 min) con el resto de
// la API -- se agotaba en minutos y de paso bloqueaba con 429 cualquier otra
// petición de esa IP/usuario (ej. la lista de geovisores dejaba de
// refrescar justo después de crear uno nuevo).
describe('rateLimiter — excluye rutas de tiles WMS/leyenda de su propio cupo', () => {
  function buildTileApp() {
    const app = express();
    app.use(rateLimiter);
    app.get('/geovisores/:slug/wms', (_req, res) => res.status(200).json({ ok: true }));
    app.get('/geovisores/:slug/capas/:capaId/leyenda', (_req, res) => res.status(200).json({ ok: true }));
    app.get('/ping', (_req, res) => res.status(200).json({ ok: true }));
    return app;
  }

  it('no aplica cabeceras de rate limit (ni cuenta contra el cupo) en /wms', async () => {
    const app = buildTileApp();
    const res = await request(app).get('/geovisores/mapa-de-prueba/wms');

    expect(res.status).toBe(200);
    expect(res.headers['ratelimit-limit']).toBeUndefined();
  });

  it('no aplica cabeceras de rate limit (ni cuenta contra el cupo) en /leyenda', async () => {
    const app = buildTileApp();
    const res = await request(app).get('/geovisores/mapa-de-prueba/capas/3/leyenda');

    expect(res.status).toBe(200);
    expect(res.headers['ratelimit-limit']).toBeUndefined();
  });

  it('una ruta que no es de tiles sigue quedando sujeta al cupo general', async () => {
    const app = buildTileApp();
    const res = await request(app).get('/ping');

    expect(res.status).toBe(200);
    expect(res.headers['ratelimit-limit']).toBe('300');
  });
});

describe('loginAccountRateLimiter — key por email, resistente a IP spoofing', () => {
  function buildLoginApp() {
    const app = express();
    app.use(express.json());
    app.use(loginAccountRateLimiter);
    app.post('/login', (_req, res) => res.status(200).json({ ok: true }));
    return app;
  }

  it('usa `login-account:<email>` como key y expone el máximo configurado (15)', async () => {
    const app = buildLoginApp();
    const res = await request(app).post('/login').send({ email: 'victima@iiap.gob.pe' });

    expect(res.status).toBe(200);
    expect(res.headers['ratelimit-limit']).toBe('15');
  });

  it('usa la IP normalizada como key cuando el body no trae email', async () => {
    const app = buildLoginApp();
    const res = await request(app).post('/login').send({});

    expect(res.status).toBe(200);
    expect(res.headers['ratelimit-limit']).toBe('15');
  });

  it('bloquea intentos repetidos contra el mismo email aunque cada request llegue con una X-Forwarded-For distinta (spoofing)', async () => {
    const app = buildLoginApp();
    const email = 'victima@iiap.gob.pe';
    let lastStatus;

    // Simula un atacante rotando IP (real o spoofed) en cada intento contra la
    // misma cuenta — si la key fuera solo la IP, esto evadiría el límite.
    for (let i = 0; i < 20; i++) {
      const res = await request(app)
        .post('/login')
        .set('X-Forwarded-For', `203.0.113.${i}`)
        .send({ email });
      lastStatus = res.status;
      if (lastStatus === 429) break;
    }

    expect(lastStatus).toBe(429);
  });
});

describe('passwordResetLimiter — key por email vs. IP', () => {
  it('usa `reset:<email>` como key cuando el body trae un email', async () => {
    const app = buildApp(passwordResetLimiter);
    const res = await request(app).post('/ping').send({ email: 'Test@IIAP.gob.pe' });

    expect(res.status).toBe(200);
    expect(res.headers['ratelimit-limit']).toBe('3');
  });

  it('usa la IP normalizada como key cuando el body no trae email', async () => {
    const app = buildApp(passwordResetLimiter);
    const res = await request(app).post('/ping').send({});

    expect(res.status).toBe(200);
    expect(res.headers['ratelimit-limit']).toBe('3');
  });

  it('usa la IP normalizada como key cuando no hay body en absoluto', async () => {
    const app = express();
    app.use(passwordResetLimiter);
    app.get('/ping', (_req, res) => res.status(200).json({ ok: true }));

    const res = await request(app).get('/ping');
    expect(res.status).toBe(200);
  });
});

// Regresión: /registro y /reenviar-verificacion solo limitaban por IP —
// un atacante con varias IPs podía "mail bombing" la bandeja de un email
// específico repitiendo envíos con el mismo correo destino.
describe('emailActionRateLimiter — key por email vs. IP (registro / reenviar-verificacion)', () => {
  it('usa `email-action:<email>` como key cuando el body trae un email', async () => {
    const app = buildApp(emailActionRateLimiter);
    const res = await request(app).post('/ping').send({ email: 'Victima@IIAP.gob.co' });

    expect(res.status).toBe(200);
    expect(res.headers['ratelimit-limit']).toBe('5');
  });

  it('usa la IP normalizada como key cuando el body no trae email', async () => {
    const app = buildApp(emailActionRateLimiter);
    const res = await request(app).post('/ping').send({});

    expect(res.status).toBe(200);
    expect(res.headers['ratelimit-limit']).toBe('5');
  });
});
