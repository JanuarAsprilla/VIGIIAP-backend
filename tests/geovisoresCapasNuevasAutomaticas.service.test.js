import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../src/config/database.js', () => ({ query: vi.fn(), getClient: vi.fn() }));
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
vi.mock('../src/modules/geovisores/capasNuevas.service.js', () => ({ obtenerCapasNuevas: vi.fn() }));
vi.mock('../src/modules/geovisores/lineaBaseCapas.js', () => ({ obtenerLineaBase: vi.fn() }));

import { query } from '../src/config/database.js';
import { obtenerConexionParaConector } from '../src/modules/geovisores/conexionesGeoserver.service.js';
import { obtenerCapasNuevas } from '../src/modules/geovisores/capasNuevas.service.js';
import { obtenerLineaBase } from '../src/modules/geovisores/lineaBaseCapas.js';
import * as geoserver from '../src/modules/geovisores/geoserver.connector.js';
import {
  obtenerCatalogoDeGeovisor, proxyWmsDeGeovisor, proxyLeyendaDeGeovisor, consultarCapaDeGeovisor,
} from '../src/modules/geovisores/geovisores.service.js';

const SELECCIONADA = 't_15_geologia:unidades';
const ANTIGUA = 't_15_geologia:antigua';
const NUEVA = 't_15_geologia:fallas';
const NUEVA_AJENA = 't_20_hidrologia:cuencas';
const NUEVA_T32 = 't_32_areas_reglamentacion_especial:resguardos';
const LINEA_BASE = new Set([SELECCIONADA, ANTIGUA]);

const conexionAuto = { id: 'conexion-uuid-1', url: 'https://geoserver.test.local/geoserver', capasNuevasAuto: true };

function filaGeovisor(overrides = {}) {
  return {
    id: 'geovisor-uuid-1', slug: 'curado', titulo: 'Curado', subtitulo: null, descripcion: null,
    cita: null, categoria: 'Geología', conexion_geoserver_id: 'conexion-uuid-1',
    workspaces_geoserver: [], capas_seleccionadas: [SELECCIONADA], capas_con_ficha: [],
    incluir_capas_nuevas: false, color_por_tema: {}, centro_lat: 5.55, centro_lng: -76.6,
    zoom_inicial: 8, basemap_defecto: 'calles', area_max_ha: null, presets_area: [],
    visibilidad: 'publico', presentacion: { mostrarMetricas: true, mostrarImagenes: false, camposPopup: [] },
    thumbnail_url: null, activo: true, orden: 0, creado_en: new Date().toISOString(),
    ...overrides,
  };
}

const publicadas = [SELECCIONADA, ANTIGUA, NUEVA, NUEVA_AJENA, NUEVA_T32].map((id) => ({ id }));
const idsDelCatalogo = (temas) => temas.flatMap((t) => t.capas.map((c) => c.id));
const respuestaProxy = { status: 200, headers: new Map(), arrayBuffer: async () => new ArrayBuffer(0) };

beforeEach(() => {
  vi.mocked(query).mockReset().mockResolvedValue({ rows: [] });
  vi.mocked(obtenerConexionParaConector).mockReset().mockResolvedValue(conexionAuto);
  vi.mocked(geoserver.obtenerCapacidadesWfs).mockReset().mockResolvedValue(publicadas);
  vi.mocked(geoserver.obtenerCapacidadesWcs).mockReset().mockResolvedValue([]);
  vi.mocked(geoserver.proxyWms).mockReset().mockResolvedValue(respuestaProxy);
  vi.mocked(geoserver.proxyLeyenda).mockReset().mockResolvedValue(respuestaProxy);
  vi.mocked(geoserver.consultarWfs).mockReset().mockResolvedValue({ type: 'FeatureCollection', features: [] });
  vi.mocked(obtenerCapasNuevas).mockReset().mockResolvedValue(new Set());
  vi.mocked(obtenerLineaBase).mockReset().mockResolvedValue(LINEA_BASE);
});

const conGeovisor = (overrides) => vi.mocked(query).mockResolvedValueOnce({ rows: [filaGeovisor(overrides)] });
const wms = (capa) => proxyWmsDeGeovisor('curado', new URLSearchParams({ layers: capa }), undefined, null);

describe('capas nuevas automáticas — catálogo', () => {
  it('admite la capa nueva (fuera de la línea base) del workspace del geovisor curado', async () => {
    conGeovisor();
    const temas = await obtenerCatalogoDeGeovisor('curado', null);
    expect(idsDelCatalogo(temas)).toEqual([SELECCIONADA, NUEVA]);
  });

  it('la capa antigua no seleccionada sigue oculta', async () => {
    conGeovisor();
    expect(idsDelCatalogo(await obtenerCatalogoDeGeovisor('curado', null))).not.toContain(ANTIGUA);
  });

  it('una capa nueva de un workspace ajeno al geovisor sigue oculta', async () => {
    conGeovisor();
    expect(idsDelCatalogo(await obtenerCatalogoDeGeovisor('curado', null))).not.toContain(NUEVA_AJENA);
  });

  it('admite la nueva de un workspace declarado en workspaces_geoserver', async () => {
    conGeovisor({ workspaces_geoserver: ['t_20_hidrologia'] });
    expect(idsDelCatalogo(await obtenerCatalogoDeGeovisor('curado', null))).toContain(NUEVA_AJENA);
  });

  it('una capa nueva en t_32 queda oculta siempre', async () => {
    conGeovisor({ workspaces_geoserver: ['t_32_areas_reglamentacion_especial'] });
    expect(idsDelCatalogo(await obtenerCatalogoDeGeovisor('curado', null))).not.toContain(NUEVA_T32);
  });

  it('con capasNuevasAuto apagada la capa nueva queda oculta', async () => {
    vi.mocked(obtenerConexionParaConector).mockResolvedValue({ ...conexionAuto, capasNuevasAuto: false });
    conGeovisor();
    expect(idsDelCatalogo(await obtenerCatalogoDeGeovisor('curado', null))).toEqual([SELECCIONADA]);
    expect(obtenerLineaBase).not.toHaveBeenCalled();
  });

  it('sin línea base en la conexión ninguna capa cuenta como nueva', async () => {
    vi.mocked(obtenerLineaBase).mockResolvedValue(new Set());
    conGeovisor();
    expect(idsDelCatalogo(await obtenerCatalogoDeGeovisor('curado', null))).toEqual([SELECCIONADA]);
  });

  it('la línea base se lee después de registrar las capas descubiertas', async () => {
    conGeovisor();
    await obtenerCatalogoDeGeovisor('curado', null);
    expect(vi.mocked(obtenerCapasNuevas).mock.invocationCallOrder[0])
      .toBeLessThan(vi.mocked(obtenerLineaBase).mock.invocationCallOrder[0]);
  });

  it('con incluirCapasNuevas conserva su comportamiento: muestra todo su workspace, también las antiguas', async () => {
    conGeovisor({ incluir_capas_nuevas: true });
    expect(idsDelCatalogo(await obtenerCatalogoDeGeovisor('curado', null))).toEqual([SELECCIONADA, ANTIGUA, NUEVA]);
  });

  it('el modo legado (sin capas seleccionadas) sigue mostrando todo su workspace', async () => {
    conGeovisor({ capas_seleccionadas: [], workspaces_geoserver: ['t_15_geologia'] });
    expect(idsDelCatalogo(await obtenerCatalogoDeGeovisor('curado', null))).toEqual([SELECCIONADA, ANTIGUA, NUEVA]);
  });

  it('la restricción de un geovisor hermano más restrictivo gana sobre la regla nueva', async () => {
    conGeovisor();
    vi.mocked(query).mockResolvedValueOnce({
      rows: [{ workspaces_geoserver: [], capas_seleccionadas: [NUEVA], visibilidad: 'acreditados' }],
    });
    expect(idsDelCatalogo(await obtenerCatalogoDeGeovisor('curado', null))).toEqual([SELECCIONADA]);
  });
});

describe('capas nuevas automáticas — proxies por capa', () => {
  it('wms pinta la capa nueva', async () => {
    conGeovisor();
    await expect(wms(NUEVA)).resolves.toBeDefined();
    expect(geoserver.proxyWms).toHaveBeenCalled();
  });

  it('leyenda y consulta aceptan la capa nueva', async () => {
    conGeovisor();
    await expect(proxyLeyendaDeGeovisor('curado', NUEVA, null)).resolves.toBeDefined();
    conGeovisor();
    await expect(consultarCapaDeGeovisor('curado', NUEVA, { type: 'Point', coordinates: [0, 0] }, null)).resolves.toBeDefined();
  });

  it('rechazan la capa antigua no seleccionada con 403', async () => {
    conGeovisor();
    await expect(wms(ANTIGUA)).rejects.toMatchObject({ status: 403, code: 'CAPA_NO_PERMITIDA' });
    conGeovisor();
    await expect(proxyLeyendaDeGeovisor('curado', ANTIGUA, null)).rejects.toMatchObject({ status: 403 });
    conGeovisor();
    await expect(consultarCapaDeGeovisor('curado', ANTIGUA, {}, null)).rejects.toMatchObject({ status: 403 });
  });

  it('rechazan la nueva de un workspace ajeno y la de t_32', async () => {
    conGeovisor();
    await expect(wms(NUEVA_AJENA)).rejects.toMatchObject({ status: 403 });
    conGeovisor({ workspaces_geoserver: ['t_32_areas_reglamentacion_especial'] });
    await expect(wms(NUEVA_T32)).rejects.toMatchObject({ status: 403 });
  });

  it('con la opción apagada rechazan la capa nueva', async () => {
    vi.mocked(obtenerConexionParaConector).mockResolvedValue({ ...conexionAuto, capasNuevasAuto: false });
    conGeovisor();
    await expect(wms(NUEVA)).rejects.toMatchObject({ status: 403 });
  });

  it('sin línea base rechazan cualquier capa no seleccionada', async () => {
    vi.mocked(obtenerLineaBase).mockResolvedValue(new Set());
    conGeovisor();
    await expect(wms(NUEVA)).rejects.toMatchObject({ status: 403 });
  });

  it('el hermano más restrictivo gana también en el proxy', async () => {
    conGeovisor();
    vi.mocked(query).mockResolvedValueOnce({
      rows: [{ workspaces_geoserver: ['t_15_geologia'], capas_seleccionadas: [], visibilidad: 'usuarios' }],
    });
    await expect(wms(NUEVA)).rejects.toMatchObject({ status: 403 });
  });
});
