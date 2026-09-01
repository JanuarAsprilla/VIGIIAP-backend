/**
 * Regresión: el SSL de la conexión a Postgres debe depender de DB_SSL
 * explícitamente, no de NODE_ENV. Un servidor propio (Postgres sin TLS
 * configurado) también corre con NODE_ENV=production, y forzar SSL solo
 * por estar en producción rompía esa conexión.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';

vi.mock('pg', () => {
  function Pool(config) {
    this._config = config;
    this.on = vi.fn();
  }
  return { default: { Pool } };
});

const ORIGINAL_ENV = { ...process.env };

async function loadPoolConfig() {
  vi.resetModules();
  const { default: pool } = await import('../src/config/database.js');
  return pool._config;
}

describe('database.js — configuración SSL', () => {
  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  it('SSL deshabilitado en producción cuando DB_SSL no es "true" (servidor propio sin TLS)', async () => {
    process.env.NODE_ENV = 'production';
    delete process.env.DB_SSL;
    const config = await loadPoolConfig();
    expect(config.ssl).toBe(false);
  });

  it('SSL habilitado en producción cuando DB_SSL="true" (Supabase)', async () => {
    process.env.NODE_ENV = 'production';
    process.env.DB_SSL = 'true';
    process.env.DB_SSL_REJECT_UNAUTHORIZED = 'true';
    const config = await loadPoolConfig();
    expect(config.ssl).toEqual({ rejectUnauthorized: true });
  });

  it('DB_SSL_REJECT_UNAUTHORIZED=false permite la CA propia de Supabase', async () => {
    process.env.NODE_ENV = 'production';
    process.env.DB_SSL = 'true';
    process.env.DB_SSL_REJECT_UNAUTHORIZED = 'false';
    const config = await loadPoolConfig();
    expect(config.ssl).toEqual({ rejectUnauthorized: false });
  });

  it('SSL deshabilitado fuera de producción cuando DB_SSL no está definida', async () => {
    process.env.NODE_ENV = 'development';
    delete process.env.DB_SSL;
    const config = await loadPoolConfig();
    expect(config.ssl).toBe(false);
  });
});
