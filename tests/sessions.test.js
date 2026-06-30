import { describe, it, expect, vi, beforeEach } from 'vitest';
import crypto from 'node:crypto';

vi.mock('../src/config/database.js', () => ({
  query:     vi.fn().mockResolvedValue({ rows: [] }),
  getClient: vi.fn(),
}));

import { query } from '../src/config/database.js';
import { getSessions, revokeSession, revokeAllSessions } from '../src/modules/auth/sessions.controller.js';

function mockRes() {
  return { status: vi.fn().mockReturnThis(), json: vi.fn().mockReturnThis() };
}
const mockNext = vi.fn();

const USER = { id: 'uuid-user-1', email: 'user@iiap.org.co', rol: 'investigador' };

const SESSION_ROW = {
  id: 'uuid-session-1',
  ip: '192.168.1.1',
  user_agent: 'Mozilla/5.0',
  creado_en: new Date().toISOString(),
  expira_en: new Date(Date.now() + 3600000).toISOString(),
  token_hash: 'abc123',
};

// ── getSessions() ─────────────────────────────────────────────────────────

describe('getSessions()', () => {
  beforeEach(() => vi.clearAllMocks());

  it('retorna lista de sesiones activas', async () => {
    query.mockResolvedValueOnce({ rows: [SESSION_ROW] });
    const req = { user: USER, cookies: {} };
    const res = mockRes();
    await getSessions(req, res, mockNext);
    expect(res.json).toHaveBeenCalledOnce();
    const sessions = res.json.mock.calls[0][0];
    expect(Array.isArray(sessions)).toBe(true);
    expect(sessions[0].id).toBe('uuid-session-1');
    expect(sessions[0].esSesionActual).toBe(false);
  });

  it('marca esSesionActual=true cuando el hash del refresh cookie coincide', async () => {
    const fakeRefreshToken = 'fake-refresh-token-value';
    const expectedHash = crypto.createHash('sha256').update(fakeRefreshToken).digest('hex');
    const sessionWithHash = { ...SESSION_ROW, token_hash: expectedHash };
    query.mockResolvedValueOnce({ rows: [sessionWithHash] });
    const req = { user: USER, cookies: { vigiiap_refresh: fakeRefreshToken } };
    const res = mockRes();
    await getSessions(req, res, mockNext);
    const sessions = res.json.mock.calls[0][0];
    expect(sessions[0].esSesionActual).toBe(true);
  });

  it('retorna lista vacía cuando no hay sesiones activas', async () => {
    query.mockResolvedValueOnce({ rows: [] });
    const req = { user: USER, cookies: {} };
    const res = mockRes();
    await getSessions(req, res, mockNext);
    expect(res.json).toHaveBeenCalledWith([]);
  });

  it('no incluye token_hash en la respuesta', async () => {
    query.mockResolvedValueOnce({ rows: [SESSION_ROW] });
    const req = { user: USER, cookies: {} };
    const res = mockRes();
    await getSessions(req, res, mockNext);
    const sessions = res.json.mock.calls[0][0];
    expect(sessions[0]).not.toHaveProperty('token_hash');
  });

  it('llama next(err) cuando query lanza', async () => {
    query.mockRejectedValueOnce(new Error('DB error'));
    const req = { user: USER, cookies: {} };
    const res = mockRes();
    await getSessions(req, res, mockNext);
    expect(mockNext).toHaveBeenCalledWith(expect.any(Error));
  });
});

// ── revokeSession() ───────────────────────────────────────────────────────

describe('revokeSession()', () => {
  beforeEach(() => vi.clearAllMocks());

  it('revoca una sesión específica y responde con mensaje', async () => {
    query.mockResolvedValueOnce({ rows: [{ id: 'uuid-session-1' }] });
    const req = { user: USER, params: { id: 'uuid-session-1' } };
    const res = mockRes();
    await revokeSession(req, res, mockNext);
    expect(res.json).toHaveBeenCalledWith({ message: expect.stringContaining('cerrada') });
  });

  it('retorna 404 si la sesión no existe o no pertenece al usuario', async () => {
    query.mockResolvedValueOnce({ rows: [] });
    const req = { user: USER, params: { id: 'uuid-otra-session' } };
    const res = mockRes();
    await revokeSession(req, res, mockNext);
    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ error: expect.any(String) }));
  });

  it('llama next(err) cuando query lanza', async () => {
    query.mockRejectedValueOnce(new Error('DB error'));
    const req = { user: USER, params: { id: 'uuid-session-1' } };
    const res = mockRes();
    await revokeSession(req, res, mockNext);
    expect(mockNext).toHaveBeenCalledWith(expect.any(Error));
  });
});

// ── revokeAllSessions() ───────────────────────────────────────────────────

describe('revokeAllSessions()', () => {
  beforeEach(() => vi.clearAllMocks());

  it('revoca todas las sesiones del usuario', async () => {
    query.mockResolvedValueOnce({ rows: [], rowCount: 3 });
    const req = { user: USER };
    const res = mockRes();
    await revokeAllSessions(req, res, mockNext);
    expect(query).toHaveBeenCalledOnce();
    const sql = query.mock.calls[0][0];
    expect(sql).toMatch(/UPDATE refresh_tokens/i);
    expect(res.json).toHaveBeenCalledWith({ message: expect.stringContaining('cerradas') });
  });

  it('llama next(err) cuando query lanza', async () => {
    query.mockRejectedValueOnce(new Error('DB error'));
    const req = { user: USER };
    const res = mockRes();
    await revokeAllSessions(req, res, mockNext);
    expect(mockNext).toHaveBeenCalledWith(expect.any(Error));
  });
});
