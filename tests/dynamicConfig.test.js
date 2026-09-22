/**
 * Tests para config/dynamicConfig.js — CORS extra, rate limit y correo de
 * respaldo editables desde el panel del super_admin sin redeploy.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../src/config/database.js', () => ({
  query: vi.fn(),
}));

async function loadFresh() {
  vi.resetModules();
  const dbMod = await import('../src/config/database.js');
  const mod = await import('../src/config/dynamicConfig.js');
  return { query: dbMod.query, mod };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('getExtraCorsOrigins()', () => {
  it('parsea el CSV de BD en un arreglo, sin espacios ni entradas vacías', async () => {
    const { query: q, mod } = await loadFresh();
    q.mockResolvedValue({ rows: [{ clave: 'cors_extra_origins', valor: 'https://a.co, https://b.co,,https://c.co' }] });
    expect(await mod.getExtraCorsOrigins()).toEqual(['https://a.co', 'https://b.co', 'https://c.co']);
  });

  it('retorna arreglo vacío si no hay nada guardado', async () => {
    const { query: q, mod } = await loadFresh();
    q.mockResolvedValue({ rows: [] });
    expect(await mod.getExtraCorsOrigins()).toEqual([]);
  });

  it('si la BD falla, retorna vacío en vez de romper el flujo de CORS', async () => {
    const { query: q, mod } = await loadFresh();
    q.mockRejectedValue(new Error('db down'));
    expect(await mod.getExtraCorsOrigins()).toEqual([]);
  });
});

describe('getRateLimitMax()', () => {
  it('retorna el número guardado', async () => {
    const { query: q, mod } = await loadFresh();
    q.mockResolvedValue({ rows: [{ clave: 'rate_limit_max', valor: '250' }] });
    expect(await mod.getRateLimitMax()).toBe(250);
  });

  it('retorna null si no hay valor guardado — el llamador debe caer a su propio default', async () => {
    const { query: q, mod } = await loadFresh();
    q.mockResolvedValue({ rows: [] });
    expect(await mod.getRateLimitMax()).toBeNull();
  });

  it('retorna null ante un valor inválido (0, negativo, no numérico) en vez de desactivar el límite', async () => {
    const { query: q, mod } = await loadFresh();
    q.mockResolvedValue({ rows: [{ clave: 'rate_limit_max', valor: 'no-es-un-numero' }] });
    expect(await mod.getRateLimitMax()).toBeNull();
  });
});

describe('getAdminEmailFallback()', () => {
  it('retorna el valor guardado', async () => {
    const { query: q, mod } = await loadFresh();
    q.mockResolvedValue({ rows: [{ clave: 'admin_email_fallback', valor: 'respaldo@iiap.org.co' }] });
    expect(await mod.getAdminEmailFallback()).toBe('respaldo@iiap.org.co');
  });

  it('retorna null si no hay nada guardado', async () => {
    const { query: q, mod } = await loadFresh();
    q.mockResolvedValue({ rows: [] });
    expect(await mod.getAdminEmailFallback()).toBeNull();
  });
});

describe('getPasswordMinLength()', () => {
  it('retorna el valor guardado cuando supera el piso de 8', async () => {
    const { query: q, mod } = await loadFresh();
    q.mockResolvedValue({ rows: [{ clave: 'passwordMinLength', valor: '12' }] });
    expect(await mod.getPasswordMinLength()).toBe(12);
  });

  it('nunca baja del piso de 8, ni con un valor guardado menor', async () => {
    const { query: q, mod } = await loadFresh();
    q.mockResolvedValue({ rows: [{ clave: 'passwordMinLength', valor: '5' }] });
    expect(await mod.getPasswordMinLength()).toBe(8);
  });

  it('retorna 8 si no hay nada guardado', async () => {
    const { query: q, mod } = await loadFresh();
    q.mockResolvedValue({ rows: [] });
    expect(await mod.getPasswordMinLength()).toBe(8);
  });

  it('retorna 8 ante un valor no numérico', async () => {
    const { query: q, mod } = await loadFresh();
    q.mockResolvedValue({ rows: [{ clave: 'passwordMinLength', valor: 'abc' }] });
    expect(await mod.getPasswordMinLength()).toBe(8);
  });
});

describe('getRequire2faAdmins()', () => {
  it('retorna true cuando está activado', async () => {
    const { query: q, mod } = await loadFresh();
    q.mockResolvedValue({ rows: [{ clave: 'require2faAdmins', valor: 'true' }] });
    expect(await mod.getRequire2faAdmins()).toBe(true);
  });

  it('retorna false si no hay nada guardado', async () => {
    const { query: q, mod } = await loadFresh();
    q.mockResolvedValue({ rows: [] });
    expect(await mod.getRequire2faAdmins()).toBe(false);
  });
});

describe('cache de 5 minutos + clearDynamicConfigCache()', () => {
  it('sirve de cache en llamadas seguidas — no golpea BD dos veces', async () => {
    const { query: q, mod } = await loadFresh();
    q.mockResolvedValue({ rows: [{ clave: 'rate_limit_max', valor: '99' }] });

    await mod.getRateLimitMax();
    await mod.getExtraCorsOrigins(); // mismo cache compartido, no nueva query
    expect(q).toHaveBeenCalledTimes(1);
  });

  it('clearDynamicConfigCache() fuerza releer BD en la siguiente llamada', async () => {
    const { query: q, mod } = await loadFresh();
    q.mockResolvedValue({ rows: [{ clave: 'rate_limit_max', valor: '99' }] });

    await mod.getRateLimitMax();
    expect(q).toHaveBeenCalledTimes(1);

    mod.clearDynamicConfigCache();
    await mod.getRateLimitMax();
    expect(q).toHaveBeenCalledTimes(2);
  });
});
