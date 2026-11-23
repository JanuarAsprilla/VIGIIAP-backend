import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../src/config/database.js', () => ({ query: vi.fn() }));

import { query } from '../src/config/database.js';
import { obtenerLineaBase, invalidarLineaBase, TTL_LINEA_BASE_MS } from '../src/modules/geovisores/lineaBaseCapas.js';

const CONEXION = 'conexion-1';

beforeEach(() => {
  vi.useFakeTimers();
  invalidarLineaBase(CONEXION);
  vi.mocked(query).mockReset().mockResolvedValue({ rows: [{ capa_id: 'a:x' }, { capa_id: 'a:y' }] });
});
afterEach(() => vi.useRealTimers());

describe('obtenerLineaBase', () => {
  it('consulta solo las filas es_linea_base de la conexión', async () => {
    const base = await obtenerLineaBase(CONEXION);
    const [sql, params] = vi.mocked(query).mock.calls[0];
    expect(sql).toMatch(/es_linea_base = true/);
    expect(params).toEqual([CONEXION]);
    expect(base).toEqual(new Set(['a:x', 'a:y']));
  });

  it('reutiliza la caché dentro del TTL y vuelve a consultar al vencer', async () => {
    await obtenerLineaBase(CONEXION);
    await obtenerLineaBase(CONEXION);
    expect(query).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(TTL_LINEA_BASE_MS + 1);
    await obtenerLineaBase(CONEXION);
    expect(query).toHaveBeenCalledTimes(2);
  });

  it('invalidarLineaBase fuerza una nueva consulta', async () => {
    await obtenerLineaBase(CONEXION);
    invalidarLineaBase(CONEXION);
    await obtenerLineaBase(CONEXION);
    expect(query).toHaveBeenCalledTimes(2);
  });

  it('si la BD falla devuelve vacío (nada es nuevo) y no cachea el fallo', async () => {
    vi.mocked(query).mockRejectedValueOnce(new Error('caída'));
    expect((await obtenerLineaBase(CONEXION)).size).toBe(0);
    expect((await obtenerLineaBase(CONEXION)).size).toBe(2);
  });
});
