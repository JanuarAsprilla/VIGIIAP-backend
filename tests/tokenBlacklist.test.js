import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../src/config/database.js', () => ({
  query:     vi.fn().mockResolvedValue({ rows: [] }),
  getClient: vi.fn(),
}));

vi.mock('../src/utils/logger.js', () => ({
  default: { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() },
}));

import { query } from '../src/config/database.js';
import { isRevoked, revokeToken, loadBlacklist } from '../src/utils/tokenBlacklist.js';

const TOKEN = 'eyJhbGciOiJIUzI1NiJ9.test-payload.signature';
const FUTURE = Math.floor(Date.now() / 1000) + 3600;

describe('isRevoked()', () => {
  it('retorna false para un token no revocado', () => {
    expect(isRevoked('token-no-revocado-xyzabc')).toBe(false);
  });
});

describe('revokeToken()', () => {
  beforeEach(() => vi.clearAllMocks());

  it('añade el token al set en memoria', async () => {
    query.mockResolvedValueOnce({ rows: [] });
    await revokeToken(TOKEN, FUTURE);
    expect(isRevoked(TOKEN)).toBe(true);
  });

  it('persiste el token en BD con INSERT', async () => {
    query.mockResolvedValueOnce({ rows: [] });
    await revokeToken(TOKEN + '-persist', FUTURE);
    expect(query).toHaveBeenCalledOnce();
    const sql = query.mock.calls[0][0];
    expect(sql).toMatch(/INSERT INTO revoked_tokens/i);
    expect(sql).toMatch(/ON CONFLICT/i);
  });

  it('no lanza si BD falla (fallo silencioso)', async () => {
    query.mockRejectedValueOnce(new Error('DB down'));
    await expect(revokeToken('token-bd-fail', FUTURE)).resolves.not.toThrow();
    expect(isRevoked('token-bd-fail')).toBe(true);
  });
});

describe('loadBlacklist()', () => {
  beforeEach(() => vi.clearAllMocks());

  it('purga expirados y carga tokens revocados de BD', async () => {
    const fakeHash = 'abcdef1234567890'.repeat(4);
    query
      .mockResolvedValueOnce({ rows: [] }) // DELETE expired
      .mockResolvedValueOnce({ rows: [{ token_hash: fakeHash }] }); // SELECT hashes

    await loadBlacklist();

    expect(query).toHaveBeenCalledTimes(2);
    const deleteCall = query.mock.calls[0][0];
    expect(deleteCall).toMatch(/DELETE FROM revoked_tokens/i);
  });

  it('no lanza si BD falla durante carga (fallo silencioso)', async () => {
    query.mockRejectedValueOnce(new Error('Connection refused'));
    await expect(loadBlacklist()).resolves.not.toThrow();
  });

  it('carga múltiples tokens desde BD en memoria', async () => {
    const hash1 = 'a'.repeat(64);
    const hash2 = 'b'.repeat(64);
    query
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ token_hash: hash1 }, { token_hash: hash2 }] });
    await loadBlacklist();
    expect(query).toHaveBeenCalledTimes(2);
    const selectSql = query.mock.calls[1][0];
    expect(selectSql).toMatch(/SELECT token_hash/i);
  });
});
