import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../src/config/database.js', () => ({
  query: vi.fn(),
  getClient: vi.fn(),
}));

import { query } from '../src/config/database.js';
import { obtenerCapasNuevas, DIAS_CAPA_NUEVA } from '../src/modules/geovisores/capasNuevas.service.js';

const CONEXION = 'conexion-uuid-1';
const IDS = ['t_15_geologia:unidades', 't_15_geologia:fallas'];

beforeEach(() => {
  vi.mocked(query).mockReset();
});

describe('obtenerCapasNuevas', () => {
  it('sin capas no toca la base de datos', async () => {
    const nuevas = await obtenerCapasNuevas(CONEXION, []);

    expect(nuevas.size).toBe(0);
    expect(query).not.toHaveBeenCalled();
  });

  it('la primera vez que ve una conexión guarda todo como línea base y nada sale como nuevo', async () => {
    vi.mocked(query)
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });

    const nuevas = await obtenerCapasNuevas(CONEXION, IDS);

    expect(nuevas.size).toBe(0);
    expect(vi.mocked(query).mock.calls[1][1]).toEqual([CONEXION, IDS, true]);
    expect(query).toHaveBeenCalledTimes(2);
  });

  it('después de la línea base, una capa recién vista se inserta fuera de línea base y sale como nueva', async () => {
    vi.mocked(query)
      .mockResolvedValueOnce({ rows: [{ '?column?': 1 }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ capa_id: 't_15_geologia:fallas' }] });

    const nuevas = await obtenerCapasNuevas(CONEXION, IDS);

    expect([...nuevas]).toEqual(['t_15_geologia:fallas']);
    expect(vi.mocked(query).mock.calls[1][1]).toEqual([CONEXION, IDS, false]);
  });

  it('el INSERT no pisa lo ya registrado y la consulta excluye la línea base', async () => {
    vi.mocked(query)
      .mockResolvedValueOnce({ rows: [{ '?column?': 1 }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });

    await obtenerCapasNuevas(CONEXION, IDS);

    expect(vi.mocked(query).mock.calls[1][0]).toMatch(/ON CONFLICT \(conexion_id, capa_id\) DO NOTHING/);
    expect(vi.mocked(query).mock.calls[2][0]).toMatch(/es_linea_base = false/);
  });

  it('usa una ventana de 7 días', async () => {
    vi.mocked(query)
      .mockResolvedValueOnce({ rows: [{ '?column?': 1 }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });

    await obtenerCapasNuevas(CONEXION, IDS);

    expect(vi.mocked(query).mock.calls[2][1]).toEqual([CONEXION, IDS, DIAS_CAPA_NUEVA]);
    expect(DIAS_CAPA_NUEVA).toBe(7);
  });

  it('si la base de datos falla devuelve vacío y no lanza', async () => {
    vi.mocked(query).mockRejectedValueOnce(new Error('conexión caída'));

    await expect(obtenerCapasNuevas(CONEXION, IDS)).resolves.toEqual(new Set());
  });
});
