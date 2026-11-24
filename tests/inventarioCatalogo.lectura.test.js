import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../src/config/database.js', () => ({ query: vi.fn(), getClient: vi.fn() }));
vi.mock('../src/modules/geovisores/inventarioGeoserver.store.js', () => ({ ultimaSincronizacionUtil: vi.fn() }));

import { query } from '../src/config/database.js';
import { ultimaSincronizacionUtil } from '../src/modules/geovisores/inventarioGeoserver.store.js';
import {
  obtenerInventarioParaCatalogo, invalidarInventarioCatalogo, enriquecerCapa, capasDesdeInventario,
} from '../src/modules/geovisores/inventarioCatalogo.js';

const ID = 'conexion-lectura';

beforeEach(() => {
  vi.resetAllMocks();
  invalidarInventarioCatalogo(ID);
});

function inventarioGuardado() {
  vi.mocked(ultimaSincronizacionUtil).mockResolvedValue({ terminada_en: '2026-11-24T10:00:00Z', estado: 'ok' });
  vi.mocked(query).mockImplementation(async (sql) => {
    if (/geoserver_inventario_capas/.test(sql)) return { rows: [{ capa_id: 'ws:a', titulo: 'A', tipo: 'raster', bbox: null, palabras_clave: [] }] };
    if (/geoserver_inventario_grupos/.test(sql)) return { rows: [{ grupo_id: 'ws:g', miembros: [] }] };
    return { rows: [{ nombre: 'ws', titulo_servicio: 'Espacio WS' }] };
  });
}

describe('obtenerInventarioParaCatalogo()', () => {
  it('sin sincronizaciones útiles devuelve null (primera vez)', async () => {
    vi.mocked(ultimaSincronizacionUtil).mockResolvedValue(null);
    expect(await obtenerInventarioParaCatalogo(ID)).toBeNull();
  });

  it('carga capas, grupos y títulos de espacio vigentes y los guarda en memoria', async () => {
    inventarioGuardado();

    const primero = await obtenerInventarioParaCatalogo(ID);
    const segundo = await obtenerInventarioParaCatalogo(ID);

    expect(primero.terminadaEn).toBe(Date.parse('2026-11-24T10:00:00Z'));
    expect(primero.capas.get('ws:a').titulo).toBe('A');
    expect(primero.titulosEspacio.get('ws')).toBe('Espacio WS');
    expect(segundo).toBe(primero);
    expect(ultimaSincronizacionUtil).toHaveBeenCalledTimes(1);
    expect(vi.mocked(query).mock.calls.every(([sql]) => /eliminado_en IS NULL/.test(sql))).toBe(true);
  });

  it('invalidar fuerza una nueva lectura', async () => {
    inventarioGuardado();
    await obtenerInventarioParaCatalogo(ID);
    invalidarInventarioCatalogo(ID);
    await obtenerInventarioParaCatalogo(ID);
    expect(ultimaSincronizacionUtil).toHaveBeenCalledTimes(2);
  });

  it('si la base falla devuelve null en vez de romper el catálogo', async () => {
    vi.mocked(ultimaSincronizacionUtil).mockRejectedValue(new Error('BD caída'));
    expect(await obtenerInventarioParaCatalogo(ID)).toBeNull();
  });
});

describe('funciones puras del catálogo', () => {
  it('enriquecerCapa no cambia una capa sin inventario o sin datos', () => {
    const capa = { id: 'ws:a', nombre: 'ws:a' };
    expect(enriquecerCapa(capa, null)).toBe(capa);
    expect(enriquecerCapa(capa, { capas: new Map([['ws:a', { titulo: null, resumen: '', palabras_clave: [], estilo_defecto: null }]]) })).toEqual(capa);
  });

  it('capasDesdeInventario usa el título como nombre y conserva tipo y bbox', () => {
    const inv = { capas: new Map([['ws:a', { capa_id: 'ws:a', titulo: 'A', tipo: 'raster', bbox: null }], ['ws:b', { capa_id: 'ws:b', titulo: null, tipo: 'vectorial', bbox: { oeste: 1, sur: 2, este: 3, norte: 4 } }]]) };
    expect(capasDesdeInventario(inv)).toEqual([
      { id: 'ws:a', nombre: 'A', tipo: 'raster', bbox: undefined },
      { id: 'ws:b', nombre: 'ws:b', tipo: 'vectorial', bbox: { oeste: 1, sur: 2, este: 3, norte: 4 } },
    ]);
  });
});
