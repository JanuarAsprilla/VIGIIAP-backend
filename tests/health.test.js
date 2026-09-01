import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../src/config/database.js', () => ({
  query: vi.fn(),
  getClient: vi.fn(),
  connectDB: vi.fn(),
  default: { end: vi.fn() },
}));

// Mock all modules that app.js transitively loads
vi.mock('../src/utils/tokenBlacklist.js', () => ({
  isRevoked: vi.fn().mockReturnValue(false),
  revokeToken: vi.fn(),
  loadBlacklist: vi.fn(),
  revokeAllRefreshTokens: vi.fn(),
}));

import { query } from '../src/config/database.js';
import request from 'supertest';
import app from '../src/app.js';

describe('GET /health', () => {
  beforeEach(() => vi.clearAllMocks());

  it('retorna 200 con db:ok cuando la BD responde', async () => {
    query.mockResolvedValueOnce({ rows: [{ '?column?': 1 }] });
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
    expect(res.body.db).toBe('ok');
    expect(res.body).toHaveProperty('uptime');
    expect(res.body).toHaveProperty('timestamp');
  });

  it('reporta redis:not_configured cuando REDIS_URL no está definida', async () => {
    const original = process.env.REDIS_URL;
    delete process.env.REDIS_URL;
    try {
      query.mockResolvedValueOnce({ rows: [{ '?column?': 1 }] });
      const res = await request(app).get('/health');
      expect(res.body.redis).toBe('not_configured');
    } finally {
      if (original !== undefined) process.env.REDIS_URL = original;
    }
  });

  it('retorna 503 con status:degraded cuando la BD falla', async () => {
    query.mockRejectedValueOnce(new Error('Connection refused'));
    const res = await request(app).get('/health');
    expect(res.status).toBe(503);
    expect(res.body.status).toBe('degraded');
    expect(res.body.db).toBe('unreachable');
  });
});
