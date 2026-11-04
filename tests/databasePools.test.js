import { describe, it, expect, vi, beforeEach } from 'vitest';

const creados = vi.hoisted(() => []);
vi.mock('pg', () => {
  class Pool {
    constructor(opciones) { this.opciones = opciones; this.connect = vi.fn().mockResolvedValue({ origen: opciones.max }); this.on = vi.fn(); creados.push(this); }
  }
  return { default: { Pool } };
});
vi.mock('../src/utils/logger.js', () => ({ default: { info: vi.fn(), debug: vi.fn(), error: vi.fn(), warn: vi.fn() } }));

beforeEach(() => { creados.length = 0; vi.resetModules(); delete process.env.BIODIVERSIDAD_POOL_MAX; process.env.DATABASE_URL = 'postgres://x'; });

describe('pools de base de datos', () => {
  it('el Observatorio público tiene un pool propio y pequeño, aparte del de login y panel', async () => {
    const { getClient } = await import('../src/config/database.js');
    expect(creados.map((p) => p.opciones.max)).toEqual([20, 6]);
    expect(creados[1].opciones.connectionTimeoutMillis).toBeLessThan(creados[0].opciones.connectionTimeoutMillis);
    await getClient('biodiversidad');
    expect(creados[1].connect).toHaveBeenCalledTimes(1);
    expect(creados[0].connect).not.toHaveBeenCalled();
    await getClient();
    expect(creados[0].connect).toHaveBeenCalledTimes(1);
  });

  it('el tamaño del pool del Observatorio se configura por entorno y se acota', async () => {
    process.env.BIODIVERSIDAD_POOL_MAX = '3';
    await import('../src/config/database.js');
    expect(creados[1].opciones.max).toBe(3);
    creados.length = 0; vi.resetModules();
    process.env.BIODIVERSIDAD_POOL_MAX = '500';
    await import('../src/config/database.js');
    expect(creados[1].opciones.max).toBe(10);
  });
});

describe('conLimite() con el pool del Observatorio saturado', () => {
  it('responde 503 con un mensaje claro en lugar de un 500 genérico', async () => {
    vi.resetModules();
    vi.doMock('../src/config/database.js', () => ({ getClient: vi.fn().mockRejectedValue(new Error('timeout exceeded when trying to connect')) }));
    const { conLimite } = await import('../src/modules/biodiversidad/consultas/comun.js');
    await expect(conLimite(async () => 1)).rejects.toMatchObject({ status: 503, message: expect.stringMatching(/muy solicitado/) });
    vi.doUnmock('../src/config/database.js');
  });

  it('pide la conexión al pool de biodiversidad', async () => {
    vi.resetModules();
    const getClient = vi.fn().mockResolvedValue({ query: vi.fn().mockResolvedValue({}), release: vi.fn() });
    vi.doMock('../src/config/database.js', () => ({ getClient }));
    const { conLimite } = await import('../src/modules/biodiversidad/consultas/comun.js');
    await conLimite(async () => 1);
    expect(getClient).toHaveBeenCalledWith('biodiversidad');
    vi.doUnmock('../src/config/database.js');
  });
});
