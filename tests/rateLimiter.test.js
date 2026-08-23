import { describe, it, expect } from 'vitest';
import express from 'express';
import request from 'supertest';
import {
  rateLimiter,
  authRateLimiter,
  loginAccountRateLimiter,
  uploadRateLimiter,
  downloadRateLimiter,
  adminRateLimiter,
  passwordResetLimiter,
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
  it('usa la IP normalizada como key y el máximo por defecto (100) para anónimos', async () => {
    const app = buildApp(rateLimiter);
    const res = await request(app).get('/ping');

    expect(res.status).toBe(200);
    expect(res.headers['ratelimit-limit']).toBe('100');
  });

  it('usa req.user.id como key y el máximo elevado (500) para usuarios autenticados', async () => {
    const app = buildApp(rateLimiter, { withUser: true });
    const res = await request(app).get('/ping');

    expect(res.status).toBe(200);
    expect(res.headers['ratelimit-limit']).toBe('500');
  });
});

describe('authRateLimiter', () => {
  it('permite la petición y expone el límite estricto de autenticación (10)', async () => {
    const app = buildApp(authRateLimiter);
    const res = await request(app).get('/ping');

    expect(res.status).toBe(200);
    expect(res.headers['ratelimit-limit']).toBe('10');
  });

  // Regresión: ipKeyGenerator() de express-rate-limit v8 espera un STRING (req.ip),
  // no el objeto `req` completo. Pasarle `req` hace que cada petición reciba una key
  // distinta (el propio objeto req, único por request) y el Map interno del store
  // nunca acumula hits — el limiter jamás bloquea, sin importar cuántas peticiones
  // lleguen desde la misma IP. Este test falla si esa regresión reaparece.
  it('bloquea con 429 tras superar el límite desde la misma IP (normalizeIp debe usar req.ip, no req)', async () => {
    const app = buildApp(authRateLimiter);

    const statuses = [];
    for (let i = 0; i < 15; i++) {
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
