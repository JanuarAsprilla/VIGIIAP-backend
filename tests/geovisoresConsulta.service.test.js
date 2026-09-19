import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../src/config/database.js', () => ({
  query: vi.fn(),
  getClient: vi.fn(),
}));
vi.mock('../src/modules/geovisores/conexionesGeoserver.service.js', () => ({
  obtenerConexionParaConector: vi.fn(),
}));
vi.mock('../src/modules/geovisores/geoserver.connector.js', () => ({
  proxyWms: vi.fn(),
  proxyLeyenda: vi.fn(),
  consultarWfs: vi.fn(),
}));

import { query } from '../src/config/database.js';
import { obtenerConexionParaConector } from '../src/modules/geovisores/conexionesGeoserver.service.js';
import * as geoserver from '../src/modules/geovisores/geoserver.connector.js';
import {
  proxyWmsDeGeovisor, proxyLeyendaDeGeovisor, consultarCapaDeGeovisor,
} from '../src/modules/geovisores/geovisores.service.js';

const conexion = { id: 'conexion-uuid-1', url: 'https://geoserver.test.local/geoserver' };

function filaGeovisor(overrides = {}) {
  return {
    id: 'geovisor-uuid-1', slug: 'geologia-choco', titulo: 'Geología del Chocó',
    subtitulo: null, descripcion: null, cita: null, categoria: 'Geología',
    conexion_geoserver_id: 'conexion-uuid-1', workspaces_geoserver: ['t_15_geologia'],
    color_por_tema: {}, centro_lat: 5.55, centro_lng: -76.6, zoom_inicial: 8,
    basemap_defecto: 'calles', area_max_ha: null, presets_area: [], ia_habilitada: false,
    visibilidad: 'publico', presentacion: { mostrarMetricas: true, mostrarImagenes: false, camposPopup: [] },
    thumbnail_url: null, activo: true, orden: 0, creado_en: new Date().toISOString(),
    ...overrides,
  };
}

const geometriaPunto = { type: 'Polygon', coordinates: [[[-76.6, 5.55], [-76.59, 5.55], [-76.59, 5.56], [-76.6, 5.56], [-76.6, 5.55]]] };

beforeEach(() => {
  vi.mocked(query).mockReset();
  vi.mocked(obtenerConexionParaConector).mockReset().mockResolvedValue(conexion);
  vi.mocked(geoserver.proxyWms).mockReset();
  vi.mocked(geoserver.proxyLeyenda).mockReset();
  vi.mocked(geoserver.consultarWfs).mockReset();
});

describe('proxyWmsDeGeovisor — solo capas permitidas para este geovisor', () => {
  it('permite una capa del workspace asignado', async () => {
    vi.mocked(query).mockResolvedValueOnce({ rows: [filaGeovisor()] });
    vi.mocked(geoserver.proxyWms).mockResolvedValueOnce({ status: 200, headers: new Map(), arrayBuffer: async () => new ArrayBuffer(0) });

    const params = new URLSearchParams({ layers: 't_15_geologia:unidades' });
    await expect(proxyWmsDeGeovisor('geologia-choco', params, undefined, null)).resolves.toBeDefined();
    expect(geoserver.proxyWms).toHaveBeenCalledWith(conexion, params, undefined);
  });

  it('rechaza una capa de un workspace NO asignado a este geovisor', async () => {
    vi.mocked(query).mockResolvedValueOnce({ rows: [filaGeovisor()] });

    const params = new URLSearchParams({ layers: 't_20_hidrologia:cuencas' });
    await expect(proxyWmsDeGeovisor('geologia-choco', params, undefined, null)).rejects.toMatchObject({ status: 403 });
    expect(geoserver.proxyWms).not.toHaveBeenCalled();
  });

  it('rechaza la capa de comunidades étnicas aunque esté en workspaces_geoserver por error de configuración', async () => {
    vi.mocked(query).mockResolvedValueOnce({
      rows: [filaGeovisor({ workspaces_geoserver: ['t_15_geologia', 't_32_areas_reglamentacion_especial'] })],
    });

    const params = new URLSearchParams({ layers: 't_32_areas_reglamentacion_especial:resguardos' });
    await expect(proxyWmsDeGeovisor('geologia-choco', params, undefined, null)).rejects.toMatchObject({ status: 403 });
  });

  it('con workspaces_geoserver vacío (todos), sigue bloqueando la capa siempre excluida', async () => {
    vi.mocked(query).mockResolvedValueOnce({ rows: [filaGeovisor({ workspaces_geoserver: [] })] });

    const params = new URLSearchParams({ layers: 't_32_areas_reglamentacion_especial:resguardos' });
    await expect(proxyWmsDeGeovisor('geologia-choco', params, undefined, null)).rejects.toMatchObject({ status: 403 });
  });

  it('rechaza si CUALQUIERA de varias capas pedidas a la vez no está permitida', async () => {
    vi.mocked(query).mockResolvedValueOnce({ rows: [filaGeovisor()] });

    const params = new URLSearchParams({ layers: 't_15_geologia:unidades,t_20_hidrologia:cuencas' });
    await expect(proxyWmsDeGeovisor('geologia-choco', params, undefined, null)).rejects.toMatchObject({ status: 403 });
  });
});

describe('proxyLeyendaDeGeovisor — solo capas permitidas', () => {
  it('rechaza una capa fuera del geovisor', async () => {
    vi.mocked(query).mockResolvedValueOnce({ rows: [filaGeovisor()] });
    await expect(proxyLeyendaDeGeovisor('geologia-choco', 't_20_hidrologia:cuencas', null)).rejects.toMatchObject({ status: 403 });
    expect(geoserver.proxyLeyenda).not.toHaveBeenCalled();
  });

  it('permite una capa del workspace asignado', async () => {
    vi.mocked(query).mockResolvedValueOnce({ rows: [filaGeovisor()] });
    vi.mocked(geoserver.proxyLeyenda).mockResolvedValueOnce({ status: 200, headers: new Map(), arrayBuffer: async () => new ArrayBuffer(0) });
    await expect(proxyLeyendaDeGeovisor('geologia-choco', 't_15_geologia:unidades', null)).resolves.toBeDefined();
  });
});

describe('consultarCapaDeGeovisor — popup por capa', () => {
  it('consulta las features que intersectan la geometría para una capa permitida', async () => {
    vi.mocked(query).mockResolvedValueOnce({ rows: [filaGeovisor()] });
    vi.mocked(geoserver.consultarWfs).mockResolvedValueOnce({ type: 'FeatureCollection', features: [] });

    const resultado = await consultarCapaDeGeovisor('geologia-choco', 't_15_geologia:unidades', geometriaPunto, null);

    expect(geoserver.consultarWfs).toHaveBeenCalledWith(conexion, 't_15_geologia:unidades', geometriaPunto);
    expect(resultado).toEqual({ type: 'FeatureCollection', features: [] });
  });

  it('rechaza consultar una capa que no pertenece a este geovisor', async () => {
    vi.mocked(query).mockResolvedValueOnce({ rows: [filaGeovisor()] });
    await expect(consultarCapaDeGeovisor('geologia-choco', 't_20_hidrologia:cuencas', geometriaPunto, null)).rejects.toMatchObject({ status: 403 });
    expect(geoserver.consultarWfs).not.toHaveBeenCalled();
  });
});
