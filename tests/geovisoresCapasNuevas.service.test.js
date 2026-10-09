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
  proxyWms: vi.fn(),
  proxyLeyenda: vi.fn(),
  consultarWfs: vi.fn(),
}));
vi.mock('../src/modules/fichas/fichas.service.js', () => ({
  adjuntarFichasAFeatures: vi.fn(),
  obtenerConfig: vi.fn(),
  listarFeaturesConCompletitud: vi.fn(),
}));
vi.mock('../src/modules/geovisores/capasNuevas.service.js', () => ({
  obtenerCapasNuevas: vi.fn(),
}));

import { query } from '../src/config/database.js';
import { obtenerConexionParaConector } from '../src/modules/geovisores/conexionesGeoserver.service.js';
import { obtenerCapasNuevas } from '../src/modules/geovisores/capasNuevas.service.js';
import * as geoserver from '../src/modules/geovisores/geoserver.connector.js';
import {
  obtenerCatalogoDeGeovisor, proxyWmsDeGeovisor, create,
} from '../src/modules/geovisores/geovisores.service.js';

const conexion = { id: 'conexion-uuid-1', url: 'https://geoserver.test.local/geoserver' };

function filaGeovisor(overrides = {}) {
  return {
    id: 'geovisor-uuid-1', slug: 'mezcla', titulo: 'Mezcla', subtitulo: null, descripcion: null,
    cita: null, categoria: 'Geología', conexion_geoserver_id: 'conexion-uuid-1',
    workspaces_geoserver: [], capas_seleccionadas: ['t_15_geologia:unidades'], capas_con_ficha: [],
    incluir_capas_nuevas: false, color_por_tema: {}, centro_lat: 5.55, centro_lng: -76.6,
    zoom_inicial: 8, basemap_defecto: 'calles', area_max_ha: null, presets_area: [],
    visibilidad: 'publico', presentacion: { mostrarMetricas: true, mostrarImagenes: false, camposPopup: [] },
    thumbnail_url: null, activo: true, orden: 0, creado_en: new Date().toISOString(),
    ...overrides,
  };
}

// Lo que GeoServer publica HOY: una capa nueva (fallas) en el mismo tema que la ya elegida,
// otra de un tema distinto, y una de comunidades étnicas que nunca debe salir.
const CAPAS_VECTORIALES = [
  { id: 't_15_geologia:unidades' },
  { id: 't_15_geologia:fallas' },
  { id: 't_20_hidrologia:cuencas' },
  { id: 't_32_areas_reglamentacion_especial:resguardos' },
];

const idsDelCatalogo = (temas) => temas.flatMap((t) => t.capas.map((c) => c.id));

beforeEach(() => {
  // { rows: [] } por defecto en la segunda+ llamada: obtenerRestriccionesDeHermanos()
  // sin geovisores hermanos. mockResolvedValueOnce() de cada test (fila del
  // geovisor) tiene prioridad en la primera llamada.
  vi.mocked(query).mockReset().mockResolvedValue({ rows: [] });
  vi.mocked(obtenerConexionParaConector).mockReset().mockResolvedValue(conexion);
  vi.mocked(geoserver.obtenerCapacidadesWfs).mockReset().mockResolvedValue(CAPAS_VECTORIALES);
  vi.mocked(geoserver.obtenerCapacidadesWcs).mockReset().mockResolvedValue([]);
  vi.mocked(geoserver.proxyWms).mockReset();
  vi.mocked(obtenerCapasNuevas).mockReset().mockResolvedValue(new Set());
});

describe('obtenerCatalogoDeGeovisor — insignia "nueva"', () => {
  it('marca nueva:true solo las capas que el registro reporta como nuevas', async () => {
    vi.mocked(query).mockResolvedValueOnce({ rows: [filaGeovisor({ incluir_capas_nuevas: true })] });
    vi.mocked(obtenerCapasNuevas).mockResolvedValueOnce(new Set(['t_15_geologia:fallas']));

    const temas = await obtenerCatalogoDeGeovisor('mezcla', null);
    const capas = temas.flatMap((t) => t.capas);

    expect(capas.find((c) => c.id === 't_15_geologia:fallas').nueva).toBe(true);
    expect(capas.find((c) => c.id === 't_15_geologia:unidades').nueva).toBe(false);
  });

  it('registra TODAS las capas de la conexión, no solo las visibles en este geovisor', async () => {
    vi.mocked(query).mockResolvedValueOnce({ rows: [filaGeovisor()] });

    await obtenerCatalogoDeGeovisor('mezcla', null);

    expect(obtenerCapasNuevas).toHaveBeenCalledWith('conexion-uuid-1', CAPAS_VECTORIALES.map((c) => c.id));
  });
});

describe('obtenerCatalogoDeGeovisor — capas nuevas de GeoServer', () => {
  it('sin incluir_capas_nuevas conserva la curaduría exacta: la capa nueva del mismo tema NO aparece', async () => {
    vi.mocked(query).mockResolvedValueOnce({ rows: [filaGeovisor()] });

    const temas = await obtenerCatalogoDeGeovisor('mezcla', null);

    expect(idsDelCatalogo(temas)).toEqual(['t_15_geologia:unidades']);
  });

  it('con incluir_capas_nuevas aparece la capa nueva del mismo tema, sin tocar el geovisor', async () => {
    vi.mocked(query).mockResolvedValueOnce({ rows: [filaGeovisor({ incluir_capas_nuevas: true })] });

    const temas = await obtenerCatalogoDeGeovisor('mezcla', null);

    expect(idsDelCatalogo(temas)).toEqual(['t_15_geologia:unidades', 't_15_geologia:fallas']);
  });

  it('con incluir_capas_nuevas NO mete temas que el geovisor no usa', async () => {
    vi.mocked(query).mockResolvedValueOnce({ rows: [filaGeovisor({ incluir_capas_nuevas: true })] });

    const temas = await obtenerCatalogoDeGeovisor('mezcla', null);

    expect(idsDelCatalogo(temas)).not.toContain('t_20_hidrologia:cuencas');
  });

  it('con incluir_capas_nuevas también admite los workspaces declarados en workspaces_geoserver', async () => {
    vi.mocked(query).mockResolvedValueOnce({
      rows: [filaGeovisor({ incluir_capas_nuevas: true, workspaces_geoserver: ['t_20_hidrologia'] })],
    });

    const temas = await obtenerCatalogoDeGeovisor('mezcla', null);

    expect(idsDelCatalogo(temas)).toContain('t_20_hidrologia:cuencas');
  });

  it('la exclusión de comunidades étnicas manda aunque incluir_capas_nuevas esté activo', async () => {
    vi.mocked(query).mockResolvedValueOnce({
      rows: [filaGeovisor({
        incluir_capas_nuevas: true,
        capas_seleccionadas: ['t_32_areas_reglamentacion_especial:resguardos'],
      })],
    });

    const temas = await obtenerCatalogoDeGeovisor('mezcla', null);

    expect(idsDelCatalogo(temas)).toEqual([]);
  });
});

describe('proxyWmsDeGeovisor — la capa nueva también se puede pintar, no solo listar', () => {
  it('con incluir_capas_nuevas permite una capa nueva del mismo tema', async () => {
    vi.mocked(query).mockResolvedValueOnce({ rows: [filaGeovisor({ incluir_capas_nuevas: true })] });
    vi.mocked(geoserver.proxyWms).mockResolvedValueOnce({ status: 200, headers: new Map(), arrayBuffer: async () => new ArrayBuffer(0) });

    const params = new URLSearchParams({ layers: 't_15_geologia:fallas' });
    await expect(proxyWmsDeGeovisor('mezcla', params, undefined, null)).resolves.toBeDefined();
  });

  it('con incluir_capas_nuevas sigue rechazando una capa de un tema ajeno', async () => {
    vi.mocked(query).mockResolvedValueOnce({ rows: [filaGeovisor({ incluir_capas_nuevas: true })] });

    const params = new URLSearchParams({ layers: 't_20_hidrologia:cuencas' });
    await expect(proxyWmsDeGeovisor('mezcla', params, undefined, null)).rejects.toMatchObject({ status: 403 });
    expect(geoserver.proxyWms).not.toHaveBeenCalled();
  });

  it('sin incluir_capas_nuevas rechaza la capa nueva (comportamiento legado intacto)', async () => {
    vi.mocked(query).mockResolvedValueOnce({ rows: [filaGeovisor()] });

    const params = new URLSearchParams({ layers: 't_15_geologia:fallas' });
    await expect(proxyWmsDeGeovisor('mezcla', params, undefined, null)).rejects.toMatchObject({ status: 403 });
  });
});

describe('create() — persiste incluir_capas_nuevas', () => {
  const base = {
    titulo: 'Mezcla', conexionGeoserverId: 'conexion-uuid-1', centroLat: 5.5, centroLng: -76.6,
    capasSeleccionadas: ['t_15_geologia:unidades'],
  };

  it('guarda true cuando se pide', async () => {
    vi.mocked(query).mockResolvedValueOnce({ rows: [filaGeovisor({ incluir_capas_nuevas: true })] });

    const creado = await create({ ...base, incluirCapasNuevas: true }, 'user-1');

    const [sql, params] = vi.mocked(query).mock.calls[0];
    expect(sql).toMatch(/incluir_capas_nuevas/);
    expect(params).toContain(true);
    expect(creado.incluirCapasNuevas).toBe(true);
  });

  it('por defecto guarda false: un geovisor nuevo sin la opción no cambia de comportamiento', async () => {
    vi.mocked(query).mockResolvedValueOnce({ rows: [filaGeovisor()] });

    const creado = await create(base, 'user-1');

    expect(vi.mocked(query).mock.calls[0][1]).toContain(false);
    expect(creado.incluirCapasNuevas).toBe(false);
  });
});
