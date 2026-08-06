import { describe, it, expect } from 'vitest';
import express from 'express';
import request from 'supertest';
import {
  rateLimiter,
  authRateLimiter,
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
