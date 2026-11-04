import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../src/config/database.js', () => ({ query: vi.fn() }));

import { query } from '../src/config/database.js';
import {
  exigirCuentaSinBloqueo, registrarFalloSegundoFactor, limpiarFallosSegundoFactor,
  MAX_INTENTOS_2FA, BLOQUEO_2FA_MINUTOS,
} from '../src/modules/auth/twoFactorBloqueo.js';

beforeEach(() => vi.mocked(query).mockReset());

describe('exigirCuentaSinBloqueo()', () => {
  it('deja pasar una cuenta activa y sin bloqueo', async () => {
    vi.mocked(query).mockResolvedValueOnce({ rows: [{ activo: true, bloqueado_hasta: null }] });
    await expect(exigirCuentaSinBloqueo('u1')).resolves.toBeUndefined();
  });

  it('responde 429 mientras el bloqueo siga vigente, diciendo cuántos minutos faltan', async () => {
    const hasta = new Date(Date.now() + 10 * 60_000).toISOString();
    vi.mocked(query).mockResolvedValueOnce({ rows: [{ activo: true, bloqueado_hasta: hasta }] });
    await expect(exigirCuentaSinBloqueo('u1')).rejects.toMatchObject({ status: 429, code: 'ACCOUNT_LOCKED', message: expect.stringMatching(/10 minuto/) });
  });

  it('un bloqueo vencido ya no cuenta', async () => {
    const hasta = new Date(Date.now() - 1000).toISOString();
    vi.mocked(query).mockResolvedValueOnce({ rows: [{ activo: true, bloqueado_hasta: hasta }] });
    await expect(exigirCuentaSinBloqueo('u1')).resolves.toBeUndefined();
  });

  it('rechaza con 401 una cuenta desactivada o inexistente (no emite sesión)', async () => {
    vi.mocked(query).mockResolvedValueOnce({ rows: [{ activo: false, bloqueado_hasta: null }] });
    await expect(exigirCuentaSinBloqueo('u1')).rejects.toMatchObject({ status: 401 });
    vi.mocked(query).mockResolvedValueOnce({ rows: [] });
    await expect(exigirCuentaSinBloqueo('u1')).rejects.toMatchObject({ status: 401 });
  });
});

describe('registrarFalloSegundoFactor()', () => {
  it('incrementa de forma atómica en una sola instrucción SQL y no desbloquea un bloqueo vigente', async () => {
    vi.mocked(query).mockResolvedValueOnce({ rows: [{ intentos_fallidos: 2, bloqueado_hasta: null }] });
    const r = await registrarFalloSegundoFactor('u1');
    expect(r).toEqual({ bloqueada: false, intentos: 2 });
    const [sql, params] = vi.mocked(query).mock.calls[0];
    expect(sql).toMatch(/bloqueado_hasta > NOW\(\) THEN bloqueado_hasta/);
    expect(params).toEqual(['u1', MAX_INTENTOS_2FA, BLOQUEO_2FA_MINUTOS]);
  });

  it('informa del bloqueo cuando se alcanza el umbral', async () => {
    vi.mocked(query).mockResolvedValueOnce({ rows: [{ intentos_fallidos: 0, bloqueado_hasta: new Date().toISOString() }] });
    expect(await registrarFalloSegundoFactor('u1')).toEqual({ bloqueada: true, intentos: 0 });
  });
});

describe('limpiarFallosSegundoFactor()', () => {
  it('pone el contador en cero sin tocar un bloqueo vigente', async () => {
    vi.mocked(query).mockResolvedValueOnce({ rows: [] });
    await limpiarFallosSegundoFactor('u1');
    expect(vi.mocked(query).mock.calls[0][0]).toMatch(/intentos_fallidos = 0/);
    expect(vi.mocked(query).mock.calls[0][0]).toMatch(/bloqueado_hasta IS NULL OR bloqueado_hasta <= NOW\(\)/);
  });
});
