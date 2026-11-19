import { describe, it, expect, vi, beforeEach } from 'vitest';

const cliente = { query: vi.fn(), release: vi.fn() };

vi.mock('../src/config/database.js', () => ({
  query: vi.fn(),
  connectDB: vi.fn(),
  getClient: vi.fn(async () => cliente),
}));
vi.mock('../src/utils/logger.js', () => ({ default: { info: vi.fn(), error: vi.fn() } }));
vi.mock('fs', async (original) => ({
  ...(await original()),
  readdirSync: vi.fn(() => ['001_a.sql', '002_b.sql']),
  readFileSync: vi.fn((ruta) => `SQL(${String(ruta).split('/').pop()})`),
}));

import { query } from '../src/config/database.js';
import { runMigrations, MIGRACIONES_LOCK_KEY } from '../db/migrate.js';

const sentencias = () => cliente.query.mock.calls.map(([sql]) => String(sql).trim().split('\n')[0].trim());

beforeEach(() => {
  vi.clearAllMocks();
  query.mockResolvedValue({ rows: [] });
  cliente.query.mockResolvedValue({ rows: [] });
});

describe('runMigrations — candado de asesoría entre réplicas', () => {
  it('toma el candado dentro de la transacción antes de ejecutar cada migración', async () => {
    await runMigrations();

    const lista = sentencias();
    const indiceSql = lista.indexOf('SQL(001_a.sql)');
    expect(indiceSql).toBeGreaterThan(-1);
    const previas = lista.slice(0, indiceSql);
    expect(previas.at(-3)).toBe('BEGIN');
    expect(previas.at(-2)).toMatch(/pg_advisory_xact_lock/);
    expect(cliente.query).toHaveBeenCalledWith('SELECT pg_advisory_xact_lock($1)', [MIGRACIONES_LOCK_KEY]);
    expect(lista.filter((s) => s === 'COMMIT').length).toBe(3);
  });

  it('no ejecuta la migración si otra réplica la aplicó mientras esperaba el candado', async () => {
    cliente.query.mockImplementation(async (sql) => {
      if (String(sql).startsWith('SELECT id FROM _migraciones')) return { rows: [{ id: 1 }] };
      return { rows: [] };
    });

    await runMigrations();

    const lista = sentencias();
    expect(lista).not.toContain('SQL(001_a.sql)');
    expect(lista).not.toContain('SQL(002_b.sql)');
    expect(lista.some((s) => s.startsWith('INSERT INTO _migraciones'))).toBe(false);
  });

  it('hace rollback, libera el cliente y propaga el error si una migración falla', async () => {
    cliente.query.mockImplementation(async (sql) => {
      if (String(sql) === 'SQL(001_a.sql)') throw new Error('sintaxis');
      return { rows: [] };
    });

    await expect(runMigrations()).rejects.toThrow('sintaxis');

    expect(sentencias()).toContain('ROLLBACK');
    expect(cliente.release).toHaveBeenCalledTimes(cliente.query.mock.calls.filter(([s]) => s === 'BEGIN').length);
  });

  it('omite sin tomar candado las migraciones que ya constan como aplicadas', async () => {
    query.mockResolvedValue({ rows: [{ id: 1 }] });

    await runMigrations();

    expect(sentencias().some((s) => s.startsWith('SQL('))).toBe(false);
  });
});
