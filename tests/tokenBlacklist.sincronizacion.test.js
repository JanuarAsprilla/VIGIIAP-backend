import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import crypto from 'node:crypto';

vi.mock('../src/config/database.js', () => ({ query: vi.fn() }));
vi.mock('../src/utils/logger.js', () => ({
  default: { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() },
}));

import { query } from '../src/config/database.js';
import {
  isRevoked, revokeToken, sincronizarRevocados, startSincronizacionRevocados, stopSincronizacionRevocados,
} from '../src/utils/tokenBlacklist.js';

const sha256 = (token) => crypto.createHash('sha256').update(token).digest('hex');
const enUnaHora = () => new Date(Date.now() + 3_600_000);

beforeEach(() => vi.resetAllMocks());
afterEach(() => { stopSincronizacionRevocados(); vi.useRealTimers(); });

describe('sincronizarRevocados()', () => {
  it('incorpora los tokens que otra instancia revocó después del arranque', async () => {
    const token = 'token-revocado-en-otra-instancia';
    expect(isRevoked(token)).toBe(false);
    query.mockResolvedValueOnce({ rows: [{ token_hash: sha256(token), expires_at: enUnaHora() }] });

    await sincronizarRevocados();

    expect(isRevoked(token)).toBe(true);
  });

  it('solo pide los revocados vigentes y recientes, no toda la tabla', async () => {
    query.mockResolvedValueOnce({ rows: [] });

    await sincronizarRevocados();

    const [sql, params] = query.mock.calls[0];
    expect(sql).toMatch(/FROM revoked_tokens/);
    expect(sql).toMatch(/expires_at > NOW\(\)/);
    expect(sql).toMatch(/revoked_at > NOW\(\) - make_interval/);
    expect(params[0]).toBeGreaterThan(15);
  });

  it('si la base falla no lanza y conserva lo que ya estaba revocado en memoria', async () => {
    query.mockResolvedValueOnce({ rows: [] });
    await revokeToken('token-propio', Math.floor(Date.now() / 1000) + 3600);
    query.mockRejectedValueOnce(new Error('Connection refused'));

    await expect(sincronizarRevocados()).resolves.toBeUndefined();

    expect(isRevoked('token-propio')).toBe(true);
  });

  it('olvida de la memoria los tokens que ya vencieron: un JWT vencido igual se rechaza por su firma', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-03T10:00:00Z'));
    query.mockResolvedValue({ rows: [] });
    await revokeToken('token-de-corta-vida', Math.floor(Date.now() / 1000) + 5);
    expect(isRevoked('token-de-corta-vida')).toBe(true);

    vi.setSystemTime(new Date('2026-11-03T10:00:10Z'));
    await sincronizarRevocados();

    expect(isRevoked('token-de-corta-vida')).toBe(false);
  });
});

describe('startSincronizacionRevocados() / stopSincronizacionRevocados()', () => {
  it('sincroniza periódicamente hasta que se detiene', async () => {
    vi.useFakeTimers();
    query.mockResolvedValue({ rows: [] });

    startSincronizacionRevocados(1000);
    await vi.advanceTimersByTimeAsync(3000);
    expect(query).toHaveBeenCalledTimes(3);

    stopSincronizacionRevocados();
    await vi.advanceTimersByTimeAsync(3000);
    expect(query).toHaveBeenCalledTimes(3);
  });

  it('arrancarla dos veces no duplica el temporizador', async () => {
    vi.useFakeTimers();
    query.mockResolvedValue({ rows: [] });

    startSincronizacionRevocados(1000);
    startSincronizacionRevocados(1000);
    await vi.advanceTimersByTimeAsync(2000);

    expect(query).toHaveBeenCalledTimes(2);
  });
});
