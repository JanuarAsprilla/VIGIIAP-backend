import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';

vi.mock('../src/config/database.js', () => ({
  query: vi.fn().mockResolvedValue({ rows: [] }),
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

const HEX_TOKEN = 'a'.repeat(64);

describe('app.js — CORS, redirects, docs, 404 (NODE_ENV=test)', () => {
  let request;
  let app;

  beforeAll(async () => {
    process.env.CORS_ORIGIN = 'https://vigiiap.iiap.gov.co,https://otro-origen.co';
    request = (await import('supertest')).default;
    app = (await import('../src/app.js')).default;
  });

  it('permite origin explícito en la allowlist', async () => {
    const res = await request(app)
      .get(`/verificar-email/${HEX_TOKEN}`)
      .set('Origin', 'https://vigiiap.iiap.gov.co');
    expect(res.headers['access-control-allow-origin']).toBe('https://vigiiap.iiap.gov.co');
  });

  it('bloquea origin fuera de la allowlist', async () => {
    const res = await request(app)
      .get(`/verificar-email/${HEX_TOKEN}`)
      .set('Origin', 'https://evil.example.com');
    expect(res.status).toBe(403);
  });

  it('permite requests sin Origin en entornos no-producción (curl/Postman)', async () => {
    const res = await request(app).get('/health');
    expect(res.status).not.toBe(500);
  });

  it('el preflight permite el header X-CSRF-Token — todo PATCH/POST/DELETE mutante lo envía', async () => {
    // Regresión: allowedHeaders solo tenía Content-Type/Authorization — el navegador
    // bloqueaba (CORS) cualquier petición mutante real tras el preflight, ya que
    // api.ts (frontend) siempre adjunta X-CSRF-Token en peticiones no-GET.
    const res = await request(app)
      .options('/api/v1/usuarios/me')
      .set('Origin', 'https://vigiiap.iiap.gov.co')
      .set('Access-Control-Request-Method', 'PATCH')
      .set('Access-Control-Request-Headers', 'content-type,x-csrf-token');
    expect(res.headers['access-control-allow-headers']).toContain('X-CSRF-Token');
  });

  it('añade el header Permissions-Policy a toda respuesta', async () => {
    const res = await request(app).get('/health');
    expect(res.headers['permissions-policy']).toContain('camera=()');
  });

  it('añade el header X-Response-Time', async () => {
    const res = await request(app).get('/health');
    expect(res.headers['x-response-time']).toMatch(/^\d+ms$/);
  });

  it('sirve /api/docs.json en entornos no-producción', async () => {
    const res = await request(app).get('/api/docs.json');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('openapi');
  });

  it('redirige /verificar-email/:token válido al frontend', async () => {
    const res = await request(app).get(`/verificar-email/${HEX_TOKEN}`);
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe(`https://vigiiap.iiap.gov.co/verificar-email/${HEX_TOKEN}`);
  });

  it('rechaza /verificar-email/:token con formato inválido', async () => {
    const res = await request(app).get('/verificar-email/no-es-hex');
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'Token inválido' });
  });

  it('redirige /reset-password/:token válido al frontend', async () => {
    const res = await request(app).get(`/reset-password/${HEX_TOKEN}`);
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe(`https://vigiiap.iiap.gov.co/reset-password/${HEX_TOKEN}`);
  });

  it('rechaza /reset-password/:token con formato inválido', async () => {
    const res = await request(app).get('/reset-password/no-es-hex');
    expect(res.status).toBe(400);
  });

  it('responde 404 en rutas no registradas', async () => {
    const res = await request(app).get('/esta-ruta-no-existe');
    expect(res.status).toBe(404);
  });

  afterAll(() => {
    delete process.env.CORS_ORIGIN;
  });
});

describe('app.js — CORS en producción (NODE_ENV=production)', () => {
  let request;
  let app;

  beforeAll(async () => {
    vi.resetModules();
    process.env.NODE_ENV = 'production';
    process.env.CORS_ORIGIN = 'https://vigiiap.iiap.gov.co';
    request = (await import('supertest')).default;
    app = (await import('../src/app.js')).default;
  });

  afterAll(() => {
    process.env.NODE_ENV = 'test';
    delete process.env.CORS_ORIGIN;
  });

  it('rechaza requests sin Origin en producción', async () => {
    const res = await request(app).get(`/verificar-email/${HEX_TOKEN}`);
    expect(res.status).toBe(403);
  });

  it('no monta /api/docs.json en producción', async () => {
    const res = await request(app).get('/api/docs.json').set('Origin', 'https://vigiiap.iiap.gov.co');
    expect(res.status).toBe(404);
  });
});
