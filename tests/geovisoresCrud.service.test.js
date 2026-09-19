/**
 * Tests unitarios para admin.service.js → geovisores.service.js: create(), update()
 * y obtenerCatalogoDeGeovisor() — cobertura que no existía antes de agregar
 * capas_seleccionadas y retirar ia_habilitada.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../src/config/database.js', () => ({
  query: vi.fn(),
  getClient: vi.fn(),
}));
vi.mock('../src/modules/geovisores/conexionesGeoserver.service.js', () => ({
  obtenerConexionParaConector: vi.fn(),
}));
vi.mock('../src/modules/geovisores/geoserver.connector.js', () => ({
  obtenerCapacidadesWfs: vi.fn(),
  obtenerCapacidadesWcs: vi.fn(),
}));
vi.mock('../src/utils/slugify.js', () => ({
  slugify: (s) => s.toLowerCase().replace(/\s+/g, '-'),
}));

import { query } from '../src/config/database.js';
import { obtenerConexionParaConector } from '../src/modules/geovisores/conexionesGeoserver.service.js';
import * as geoserver from '../src/modules/geovisores/geoserver.connector.js';
import { create, update, obtenerCatalogoDeGeovisor } from '../src/modules/geovisores/geovisores.service.js';

const conexion = { id: 'conexion-uuid-1', url: 'https://geoserver.test.local/geoserver' };

function filaGeovisor(overrides = {}) {
  return {
    id: 'geovisor-uuid-1', slug: 'geologia-choco', titulo: 'Geología del Chocó',
    subtitulo: null, descripcion: null, cita: null, categoria: 'Geología',
    conexion_geoserver_id: 'conexion-uuid-1', workspaces_geoserver: [],
    capas_seleccionadas: [],
    color_por_tema: {}, centro_lat: 5.55, centro_lng: -76.6, zoom_inicial: 8,
    basemap_defecto: 'calles', area_max_ha: null, presets_area: [],
    visibilidad: 'publico', thumbnail_url: null, activo: true, orden: 0,
    creado_en: new Date().toISOString(),
    ...overrides,
  };
}

beforeEach(() => {
  vi.mocked(query).mockReset();
  vi.mocked(obtenerConexionParaConector).mockReset().mockResolvedValue(conexion);
  vi.mocked(geoserver.obtenerCapacidadesWfs).mockReset();
  vi.mocked(geoserver.obtenerCapacidadesWcs).mockReset();
});

describe('create() — persiste capas_seleccionadas, ya no manda ia_habilitada', () => {
  it('inserta capas_seleccionadas tal cual vienen en el input', async () => {
    query.mockResolvedValueOnce({
      rows: [filaGeovisor({ capas_seleccionadas: ['t_15_geologia:unidades', 't_20_hidrologia:cuencas'] })],
    });

    const resultado = await create({
      titulo: 'Geología del Chocó', conexionGeoserverId: 'conexion-uuid-1',
      centroLat: 5.55, centroLng: -76.6,
      capasSeleccionadas: ['t_15_geologia:unidades', 't_20_hidrologia:cuencas'],
    }, 'user-uuid-1');

    const [sql, params] = query.mock.calls[0];
    expect(sql).toMatch(/capas_seleccionadas/);
    expect(sql).not.toMatch(/ia_habilitada/);
    expect(params).toContainEqual(['t_15_geologia:unidades', 't_20_hidrologia:cuencas']);
    expect(resultado.capasSeleccionadas).toEqual(['t_15_geologia:unidades', 't_20_hidrologia:cuencas']);
  });

  it('capas_seleccionadas por defecto es un arreglo vacío cuando no se envía', async () => {
    query.mockResolvedValueOnce({ rows: [filaGeovisor()] });

    await create({
      titulo: 'Geología del Chocó', conexionGeoserverId: 'conexion-uuid-1',
      centroLat: 5.55, centroLng: -76.6,
    }, 'user-uuid-1');

    const [, params] = query.mock.calls[0];
    expect(params).toContainEqual([]);
  });
});

describe('update() — capasSeleccionadas viaja por MAPA_CAMPOS como columna simple (no JSON)', () => {
  it('actualiza capas_seleccionadas cuando se envía', async () => {
    query.mockResolvedValueOnce({
      rows: [filaGeovisor({ capas_seleccionadas: ['t_15_geologia:unidades'] })],
    });

    await update('geovisor-uuid-1', { capasSeleccionadas: ['t_15_geologia:unidades'] });

    const [sql, params] = query.mock.calls[0];
    expect(sql).toMatch(/capas_seleccionadas = \$1/);
    expect(params[0]).toEqual(['t_15_geologia:unidades']);
  });

  it('no toca capas_seleccionadas si no viene en el input (SET dinámico)', async () => {
    query.mockResolvedValueOnce({ rows: [filaGeovisor()] });

    await update('geovisor-uuid-1', { titulo: 'Nuevo título' });

    const [sql] = query.mock.calls[0];
    expect(sql).not.toMatch(/capas_seleccionadas/);
  });
});

describe('obtenerCatalogoDeGeovisor() — filtra por capas_seleccionadas, mezcla temas distintos', () => {
  it('cuando hay capas_seleccionadas, solo incluye esas capas exactas, agrupadas por su propio tema', async () => {
    query.mockResolvedValueOnce({
      rows: [filaGeovisor({
        workspaces_geoserver: [],
        capas_seleccionadas: ['t_15_geologia:unidades', 't_20_hidrologia:cuencas'],
      })],
    });
    geoserver.obtenerCapacidadesWfs.mockResolvedValueOnce([
      { id: 't_15_geologia:unidades', nombre: 'Unidades', tipo: 'vectorial', bbox: null },
      { id: 't_15_geologia:fallas', nombre: 'Fallas', tipo: 'vectorial', bbox: null }, // NO seleccionada
      { id: 't_20_hidrologia:cuencas', nombre: 'Cuencas', tipo: 'vectorial', bbox: null },
    ]);
    geoserver.obtenerCapacidadesWcs.mockResolvedValueOnce([]);

    const temas = await obtenerCatalogoDeGeovisor('geologia-choco', null);

    const idsIncluidos = temas.flatMap((t) => t.capas.map((c) => c.id));
    expect(idsIncluidos).toEqual(['t_15_geologia:unidades', 't_20_hidrologia:cuencas']);
    expect(idsIncluidos).not.toContain('t_15_geologia:fallas');
    // Dos temas distintos representados — la mezcla cross-tema es justamente el punto.
    expect(temas.map((t) => t.id).sort()).toEqual(['geologia', 'hidrologia']);
  });

  it('sin capas_seleccionadas, cae al comportamiento legado por workspaces_geoserver', async () => {
    query.mockResolvedValueOnce({
      rows: [filaGeovisor({ workspaces_geoserver: ['t_15_geologia'], capas_seleccionadas: [] })],
    });
    geoserver.obtenerCapacidadesWfs.mockResolvedValueOnce([
      { id: 't_15_geologia:unidades', nombre: 'Unidades', tipo: 'vectorial', bbox: null },
      { id: 't_20_hidrologia:cuencas', nombre: 'Cuencas', tipo: 'vectorial', bbox: null },
    ]);
    geoserver.obtenerCapacidadesWcs.mockResolvedValueOnce([]);

    const temas = await obtenerCatalogoDeGeovisor('geologia-choco', null);

    const idsIncluidos = temas.flatMap((t) => t.capas.map((c) => c.id));
    expect(idsIncluidos).toEqual(['t_15_geologia:unidades']);
  });

  it('la exclusión de seguridad se aplica incluso si capas_seleccionadas la incluye', async () => {
    query.mockResolvedValueOnce({
      rows: [filaGeovisor({
        workspaces_geoserver: [],
        capas_seleccionadas: ['t_32_areas_reglamentacion_especial:resguardos', 't_15_geologia:unidades'],
      })],
    });
    geoserver.obtenerCapacidadesWfs.mockResolvedValueOnce([
      { id: 't_32_areas_reglamentacion_especial:resguardos', nombre: 'Resguardos', tipo: 'vectorial', bbox: null },
      { id: 't_15_geologia:unidades', nombre: 'Unidades', tipo: 'vectorial', bbox: null },
    ]);
    geoserver.obtenerCapacidadesWcs.mockResolvedValueOnce([]);

    const temas = await obtenerCatalogoDeGeovisor('geologia-choco', null);

    const idsIncluidos = temas.flatMap((t) => t.capas.map((c) => c.id));
    expect(idsIncluidos).toEqual(['t_15_geologia:unidades']);
  });
});
