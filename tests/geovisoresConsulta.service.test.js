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
vi.mock('../src/modules/fichas/fichas.service.js', () => ({
  adjuntarFichasAFeatures: vi.fn(),
}));

import { query } from '../src/config/database.js';
import { obtenerConexionParaConector } from '../src/modules/geovisores/conexionesGeoserver.service.js';
import * as geoserver from '../src/modules/geovisores/geoserver.connector.js';
import { adjuntarFichasAFeatures } from '../src/modules/fichas/fichas.service.js';
import {
  proxyWmsDeGeovisor, proxyLeyendaDeGeovisor, consultarCapaDeGeovisor,
} from '../src/modules/geovisores/geovisores.service.js';

const conexion = { id: 'conexion-uuid-1', url: 'https://geoserver.test.local/geoserver' };

function filaGeovisor(overrides = {}) {
  return {
    id: 'geovisor-uuid-1', slug: 'geologia-choco', titulo: 'Geología del Chocó',
    subtitulo: null, descripcion: null, cita: null, categoria: 'Geología',
    conexion_geoserver_id: 'conexion-uuid-1', workspaces_geoserver: ['t_15_geologia'],
    capas_seleccionadas: [],
    color_por_tema: {}, centro_lat: 5.55, centro_lng: -76.6, zoom_inicial: 8,
    basemap_defecto: 'calles', area_max_ha: null, presets_area: [],
    visibilidad: 'publico', presentacion: { mostrarMetricas: true, mostrarImagenes: false, camposPopup: [] },
    thumbnail_url: null, activo: true, orden: 0, creado_en: new Date().toISOString(),
    ...overrides,
  };
}

const geometriaPunto = { type: 'Polygon', coordinates: [[[-76.6, 5.55], [-76.59, 5.55], [-76.59, 5.56], [-76.6, 5.56], [-76.6, 5.55]]] };

beforeEach(() => {
  // Segunda llamada a query() dentro de cada proxy*/consultar() -- resuelve
  // obtenerRestriccionesDeHermanos(); { rows: [] } = sin geovisores hermanos
  // (comportamiento histórico, sin restricciones cruzadas) por defecto.
  // Los mockResolvedValueOnce() de cada test para la fila del geovisor
  // tienen prioridad en la PRIMERA llamada; esta es la que aplica después.
  vi.mocked(query).mockReset().mockResolvedValue({ rows: [] });
  vi.mocked(obtenerConexionParaConector).mockReset().mockResolvedValue(conexion);
  vi.mocked(geoserver.proxyWms).mockReset();
  vi.mocked(geoserver.proxyLeyenda).mockReset();
  vi.mocked(geoserver.consultarWfs).mockReset();
  vi.mocked(adjuntarFichasAFeatures).mockReset();
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

  it('REGRESIÓN (geovisor-shared-connection-layer-bypass): un geovisor público no sirve una capa reservada por un hermano restringido en la misma conexión', async () => {
    // Este geovisor es público y tiene workspaces_geoserver vacío ("legado:
    // toda la conexión"), el estado por defecto de cualquier geovisor nuevo.
    vi.mocked(query)
      .mockResolvedValueOnce({ rows: [filaGeovisor({ workspaces_geoserver: [], visibilidad: 'publico' })] })
      // Un hermano en la MISMA conexión, con visibilidad "acreditados" (más
      // restrictiva), reclama explícitamente el workspace sensible.
      .mockResolvedValueOnce({ rows: [{ workspaces_geoserver: ['t_99_sensible'], capas_seleccionadas: [], visibilidad: 'acreditados' }] });

    const params = new URLSearchParams({ layers: 't_99_sensible:capa_restringida' });
    await expect(proxyWmsDeGeovisor('geologia-choco', params, undefined, null)).rejects.toMatchObject({ status: 403 });
    expect(geoserver.proxyWms).not.toHaveBeenCalled();
  });

  it('un hermano con visibilidad IGUAL o MENOS restrictiva no bloquea nada (solo lo estrictamente más restrictivo reserva)', async () => {
    vi.mocked(query)
      .mockResolvedValueOnce({ rows: [filaGeovisor({ workspaces_geoserver: [], visibilidad: 'publico' })] })
      .mockResolvedValueOnce({ rows: [{ workspaces_geoserver: ['t_99_otro'], capas_seleccionadas: [], visibilidad: 'publico' }] });
    vi.mocked(geoserver.proxyWms).mockResolvedValueOnce({ status: 200, headers: new Map(), arrayBuffer: async () => new ArrayBuffer(0) });

    const params = new URLSearchParams({ layers: 't_99_otro:capa' });
    await expect(proxyWmsDeGeovisor('geologia-choco', params, undefined, null)).resolves.toBeDefined();
  });
});

describe('proxyWmsDeGeovisor — capas_seleccionadas (capas sueltas de distintos workspaces)', () => {
  it('permite mezclar dos capas de dos workspaces/temas distintos', async () => {
    vi.mocked(query).mockResolvedValueOnce({
      rows: [filaGeovisor({
        workspaces_geoserver: [],
        capas_seleccionadas: ['t_15_geologia:unidades', 't_20_hidrologia:cuencas'],
      })],
    });
    vi.mocked(geoserver.proxyWms).mockResolvedValueOnce({ status: 200, headers: new Map(), arrayBuffer: async () => new ArrayBuffer(0) });

    const params = new URLSearchParams({ layers: 't_15_geologia:unidades,t_20_hidrologia:cuencas' });
    await expect(proxyWmsDeGeovisor('geologia-choco', params, undefined, null)).resolves.toBeDefined();
  });

  it('rechaza una capa del workspace correcto que no está en capas_seleccionadas — la lista es exacta, no por workspace', async () => {
    vi.mocked(query).mockResolvedValueOnce({
      rows: [filaGeovisor({
        workspaces_geoserver: ['t_15_geologia'],
        capas_seleccionadas: ['t_15_geologia:unidades'],
      })],
    });

    const params = new URLSearchParams({ layers: 't_15_geologia:fallas' }); // mismo workspace, otra capa
    await expect(proxyWmsDeGeovisor('geologia-choco', params, undefined, null)).rejects.toMatchObject({ status: 403 });
  });

  it('capas_seleccionadas manda sobre workspaces_geoserver cuando ambos están presentes', async () => {
    vi.mocked(query).mockResolvedValueOnce({
      rows: [filaGeovisor({
        workspaces_geoserver: ['t_20_hidrologia'], // NO incluye geología
        capas_seleccionadas: ['t_15_geologia:unidades'], // pero sí eligió esta capa suelta
      })],
    });
    vi.mocked(geoserver.proxyWms).mockResolvedValueOnce({ status: 200, headers: new Map(), arrayBuffer: async () => new ArrayBuffer(0) });

    const params = new URLSearchParams({ layers: 't_15_geologia:unidades' });
    await expect(proxyWmsDeGeovisor('geologia-choco', params, undefined, null)).resolves.toBeDefined();
  });

  it('la exclusión de seguridad sigue bloqueando aunque capas_seleccionadas la incluya por error', async () => {
    vi.mocked(query).mockResolvedValueOnce({
      rows: [filaGeovisor({
        workspaces_geoserver: [],
        capas_seleccionadas: ['t_32_areas_reglamentacion_especial:resguardos'],
      })],
    });

    const params = new URLSearchParams({ layers: 't_32_areas_reglamentacion_especial:resguardos' });
    await expect(proxyWmsDeGeovisor('geologia-choco', params, undefined, null)).rejects.toMatchObject({ status: 403 });
    expect(geoserver.proxyWms).not.toHaveBeenCalled();
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

  it('REGRESIÓN (geovisor-shared-connection-layer-bypass): no consulta una capa reservada por un hermano más restrictivo', async () => {
    vi.mocked(query)
      .mockResolvedValueOnce({ rows: [filaGeovisor({ workspaces_geoserver: [], visibilidad: 'publico' })] })
      .mockResolvedValueOnce({ rows: [{ workspaces_geoserver: ['t_99_sensible'], capas_seleccionadas: [], visibilidad: 'acreditados' }] });

    await expect(consultarCapaDeGeovisor('geologia-choco', 't_99_sensible:capa', geometriaPunto, null))
      .rejects.toMatchObject({ status: 403 });
    expect(geoserver.consultarWfs).not.toHaveBeenCalled();
  });

  it('rechaza consultar una capa que no pertenece a este geovisor', async () => {
    vi.mocked(query).mockResolvedValueOnce({ rows: [filaGeovisor()] });
    await expect(consultarCapaDeGeovisor('geologia-choco', 't_20_hidrologia:cuencas', geometriaPunto, null)).rejects.toMatchObject({ status: 403 });
    expect(geoserver.consultarWfs).not.toHaveBeenCalled();
  });

  it('no llama a adjuntarFichasAFeatures si la capa no tiene el modo fichas por punto habilitado', async () => {
    vi.mocked(query).mockResolvedValueOnce({ rows: [filaGeovisor({ capas_con_ficha: [] })] });
    vi.mocked(geoserver.consultarWfs).mockResolvedValueOnce({ type: 'FeatureCollection', features: [] });

    const resultado = await consultarCapaDeGeovisor('geologia-choco', 't_15_geologia:unidades', geometriaPunto, null);

    expect(adjuntarFichasAFeatures).not.toHaveBeenCalled();
    expect(resultado).toEqual({ type: 'FeatureCollection', features: [] });
  });

  it('llama a adjuntarFichasAFeatures y devuelve su resultado si la capa SÍ tiene el modo habilitado', async () => {
    vi.mocked(query).mockResolvedValueOnce({
      rows: [filaGeovisor({ capas_seleccionadas: ['t_15_geologia:unidades'], capas_con_ficha: ['t_15_geologia:unidades'] })],
    });
    vi.mocked(geoserver.consultarWfs).mockResolvedValueOnce({ type: 'FeatureCollection', features: [{ properties: {} }] });
    const coleccionConFichas = { type: 'FeatureCollection', features: [{ properties: {}, ficha: null }] };
    vi.mocked(adjuntarFichasAFeatures).mockResolvedValueOnce(coleccionConFichas);

    const resultado = await consultarCapaDeGeovisor('geologia-choco', 't_15_geologia:unidades', geometriaPunto, null);

    expect(adjuntarFichasAFeatures).toHaveBeenCalledWith('conexion-uuid-1', 't_15_geologia:unidades', { type: 'FeatureCollection', features: [{ properties: {} }] });
    expect(resultado).toBe(coleccionConFichas);
  });

  it('trata capas_con_ficha ausente en la fila (fixtures/filas viejas) como vacío, sin reventar', async () => {
    const fila = filaGeovisor();
    delete fila.capas_con_ficha;
    vi.mocked(query).mockResolvedValueOnce({ rows: [fila] });
    vi.mocked(geoserver.consultarWfs).mockResolvedValueOnce({ type: 'FeatureCollection', features: [] });

    await expect(consultarCapaDeGeovisor('geologia-choco', 't_15_geologia:unidades', geometriaPunto, null)).resolves.toBeDefined();
    expect(adjuntarFichasAFeatures).not.toHaveBeenCalled();
  });
});
