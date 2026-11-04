import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../src/config/database.js', () => ({ query: vi.fn() }));

import { query } from '../src/config/database.js';
import {
  reservarIntentoSegundoFactor, limpiarFallosSegundoFactor, MAX_INTENTOS_2FA, BLOQUEO_2FA_MINUTOS,
} from '../src/modules/auth/twoFactorBloqueo.js';

beforeEach(() => vi.mocked(query).mockReset());

describe('reservarIntentoSegundoFactor()', () => {
  it('reserva el intento con la fila bloqueada (FOR UPDATE) y en una sola instrucción atómica', async () => {
    vi.mocked(query).mockResolvedValueOnce({ rows: [{ estaba_bloqueada: false, bloqueado_hasta: null }] });
    await expect(reservarIntentoSegundoFactor('u1')).resolves.toEqual({ bloqueaAhora: false });
    const [sql, params] = vi.mocked(query).mock.calls[0];
    expect(sql).toMatch(/FOR UPDATE/);
    expect(sql).toMatch(/WHEN p\.estaba_bloqueada THEN u\.bloqueado_hasta/);
    expect(params).toEqual(['u1', MAX_INTENTOS_2FA, BLOQUEO_2FA_MINUTOS]);
  });

  it('el intento que agota el cupo se verifica, pero avisa de que bloquea ahora', async () => {
    vi.mocked(query).mockResolvedValueOnce({ rows: [{ estaba_bloqueada: false, bloqueado_hasta: new Date(Date.now() + 900_000).toISOString() }] });
    await expect(reservarIntentoSegundoFactor('u1')).resolves.toEqual({ bloqueaAhora: true });
  });

  it('con un bloqueo vigente responde 429 con los minutos que faltan y no deja verificar', async () => {
    vi.mocked(query).mockResolvedValueOnce({ rows: [{ estaba_bloqueada: true, bloqueado_hasta: new Date(Date.now() + 10 * 60_000).toISOString() }] });
    await expect(reservarIntentoSegundoFactor('u1')).rejects.toMatchObject({ status: 429, code: 'ACCOUNT_LOCKED', message: expect.stringMatching(/10 minuto/) });
  });

  it('cuenta inexistente o desactivada: 401 y no se emite sesión', async () => {
    vi.mocked(query).mockResolvedValueOnce({ rows: [] });
    await expect(reservarIntentoSegundoFactor('u1')).rejects.toMatchObject({ status: 401 });
  });
});

describe('limpiarFallosSegundoFactor()', () => {
  it('un código correcto pone el contador a cero y quita el bloqueo', async () => {
    vi.mocked(query).mockResolvedValueOnce({ rows: [] });
    await limpiarFallosSegundoFactor('u1');
    expect(vi.mocked(query).mock.calls[0][0]).toMatch(/intentos_fallidos = 0, bloqueado_hasta = NULL/);
  });
});
