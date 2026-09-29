/**
 * Tests de calcularCompletitud() y toggleActivo() -- fase 4 de "Fichas por
 * punto en geovisores": bloqueo 409 GEOVISOR_INCOMPLETO al intentar activar
 * un geovisor con capas de fichas incompletas. Desactivar nunca se bloquea.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../src/config/database.js', () => ({
  query: vi.fn(),
}));
vi.mock('../src/modules/geovisores/conexionesGeoserver.service.js', () => ({
  obtenerConexionParaConector: vi.fn(),
}));
vi.mock('../src/modules/geovisores/geoserver.connector.js', () => ({
  obtenerCapacidadesWfs: vi.fn(),
  obtenerCapacidadesWcs: vi.fn(),
  consultarWfs: vi.fn(),
}));
vi.mock('../src/modules/fichas/fichas.service.js', () => ({
  adjuntarFichasAFeatures: vi.fn(),
  obtenerConfig: vi.fn(),
  listarFeaturesConCompletitud: vi.fn(),
}));

import { query } from '../src/config/database.js';
import { obtenerConfig, listarFeaturesConCompletitud } from '../src/modules/fichas/fichas.service.js';
import { getById, calcularCompletitud, toggleActivo } from '../src/modules/geovisores/geovisores.service.js';

function filaGeovisor(overrides = {}) {
  return {
    id: 'geovisor-1', slug: 'estaciones-clima', titulo: 'Estaciones climáticas',
    subtitulo: null, descripcion: null, cita: null, categoria: 'Clima',
    conexion_geoserver_id: 'conexion-1', workspaces_geoserver: [],
    capas_seleccionadas: ['t_19_clima:estaciones'], capas_con_ficha: ['t_19_clima:estaciones'],
    color_por_tema: {}, centro_lat: 5.55, centro_lng: -76.6, zoom_inicial: 8,
    basemap_defecto: 'calles', area_max_ha: null, presets_area: [],
    visibilidad: 'publico', thumbnail_url: null, activo: false, orden: 0,
    presentacion: { mostrarMetricas: true, mostrarImagenes: false, camposPopup: [] },
    creado_en: new Date().toISOString(),
    ...overrides,
  };
}

function resumenCompleto(overrides = {}) {
  return { totalFeatures: 5, completas: 5, incompletas: 0, sinIdentificador: 0, identificadoresDuplicados: [], huerfanas: [], ...overrides };
}

beforeEach(() => {
  vi.mocked(query).mockReset();
  vi.mocked(obtenerConfig).mockReset();
  vi.mocked(listarFeaturesConCompletitud).mockReset();
});

describe('getById()', () => {
  it('lanza 404 si el geovisor no existe o fue eliminado', async () => {
    query.mockResolvedValueOnce({ rows: [] });
    await expect(getById('geovisor-x')).rejects.toMatchObject({ status: 404 });
  });

  it('devuelve el geovisor mapeado a camelCase', async () => {
    query.mockResolvedValueOnce({ rows: [filaGeovisor()] });
    const geovisor = await getById('geovisor-1');
    expect(geovisor).toMatchObject({ id: 'geovisor-1', capasConFicha: ['t_19_clima:estaciones'] });
  });
});

describe('calcularCompletitud()', () => {
  it('publicable=true cuando el geovisor no usa fichas por punto (capasConFicha vacío)', async () => {
    query.mockResolvedValueOnce({ rows: [filaGeovisor({ capas_con_ficha: [] })] });

    const resultado = await calcularCompletitud('geovisor-1');

    expect(resultado).toEqual({ publicable: true, capas: [] });
    expect(obtenerConfig).not.toHaveBeenCalled();
  });

  it('publicable=false y sinConfigurar=true si la capa no tiene config todavía (nadie eligió identificador)', async () => {
    query.mockResolvedValueOnce({ rows: [filaGeovisor()] });
    obtenerConfig.mockResolvedValueOnce(null);

    const resultado = await calcularCompletitud('geovisor-1');

    expect(resultado.publicable).toBe(false);
    expect(resultado.capas[0]).toMatchObject({ capaId: 't_19_clima:estaciones', sinConfigurar: true, bloqueantes: null });
    expect(listarFeaturesConCompletitud).not.toHaveBeenCalled();
  });

  it('publicable=true si todas las capas configuradas están completas', async () => {
    query.mockResolvedValueOnce({ rows: [filaGeovisor()] });
    obtenerConfig.mockResolvedValueOnce({ id: 'config-1' });
    listarFeaturesConCompletitud.mockResolvedValueOnce({ resumen: resumenCompleto() });

    const resultado = await calcularCompletitud('geovisor-1');

    expect(resultado.publicable).toBe(true);
    expect(resultado.capas[0]).toMatchObject({ capaId: 't_19_clima:estaciones', bloqueantes: 0 });
  });

  it('publicable=false si hay features incompletas, aunque no haya sinIdentificador', async () => {
    query.mockResolvedValueOnce({ rows: [filaGeovisor()] });
    obtenerConfig.mockResolvedValueOnce({ id: 'config-1' });
    listarFeaturesConCompletitud.mockResolvedValueOnce({ resumen: resumenCompleto({ completas: 3, incompletas: 2 }) });

    const resultado = await calcularCompletitud('geovisor-1');

    expect(resultado.publicable).toBe(false);
    expect(resultado.capas[0].bloqueantes).toBe(2);
  });

  it('publicable=false si hay features sin identificador', async () => {
    query.mockResolvedValueOnce({ rows: [filaGeovisor()] });
    obtenerConfig.mockResolvedValueOnce({ id: 'config-1' });
    listarFeaturesConCompletitud.mockResolvedValueOnce({ resumen: resumenCompleto({ completas: 4, sinIdentificador: 1 }) });

    const resultado = await calcularCompletitud('geovisor-1');

    expect(resultado.publicable).toBe(false);
    expect(resultado.capas[0].bloqueantes).toBe(1);
  });

  it('identificadores duplicados y fichas huérfanas NO bloquean la publicación (son avisos)', async () => {
    query.mockResolvedValueOnce({ rows: [filaGeovisor()] });
    obtenerConfig.mockResolvedValueOnce({ id: 'config-1' });
    listarFeaturesConCompletitud.mockResolvedValueOnce({
      resumen: resumenCompleto({ identificadoresDuplicados: ['EST-01'], huerfanas: ['EST-VIEJA'] }),
    });

    const resultado = await calcularCompletitud('geovisor-1');

    expect(resultado.publicable).toBe(true);
  });

  it('evalúa cada capa de capasConFicha de forma independiente', async () => {
    query.mockResolvedValueOnce({
      rows: [filaGeovisor({ capas_seleccionadas: ['t_19_clima:estaciones', 't_20_hidrologia:cuencas'], capas_con_ficha: ['t_19_clima:estaciones', 't_20_hidrologia:cuencas'] })],
    });
    obtenerConfig
      .mockResolvedValueOnce({ id: 'config-1' })
      .mockResolvedValueOnce({ id: 'config-2' });
    listarFeaturesConCompletitud
      .mockResolvedValueOnce({ resumen: resumenCompleto() }) // capa 1: completa
      .mockResolvedValueOnce({ resumen: resumenCompleto({ completas: 1, incompletas: 4 }) }); // capa 2: incompleta

    const resultado = await calcularCompletitud('geovisor-1');

    expect(resultado.publicable).toBe(false);
    expect(resultado.capas).toHaveLength(2);
    expect(resultado.capas.find((c) => c.capaId === 't_19_clima:estaciones').bloqueantes).toBe(0);
    expect(resultado.capas.find((c) => c.capaId === 't_20_hidrologia:cuencas').bloqueantes).toBe(4);
  });
});

describe('toggleActivo()', () => {
  it('desactivar (activo=false) NUNCA valida completitud, ni aunque esté incompleto', async () => {
    query.mockResolvedValueOnce({ rows: [filaGeovisor({ activo: true })] }); // UPDATE directo

    await toggleActivo('geovisor-1', false);

    expect(obtenerConfig).not.toHaveBeenCalled();
    expect(listarFeaturesConCompletitud).not.toHaveBeenCalled();
  });

  it('activar (activo=true) con todo completo: pasa y actualiza', async () => {
    query
      .mockResolvedValueOnce({ rows: [filaGeovisor()] }) // getById (dentro de calcularCompletitud)
      .mockResolvedValueOnce({ rows: [filaGeovisor({ activo: true })] }); // UPDATE
    obtenerConfig.mockResolvedValueOnce({ id: 'config-1' });
    listarFeaturesConCompletitud.mockResolvedValueOnce({ resumen: resumenCompleto() });

    const resultado = await toggleActivo('geovisor-1', true);

    expect(resultado.activo).toBe(true);
  });

  it('activar (activo=true) incompleto: lanza 409 GEOVISOR_INCOMPLETO con el detalle en fields, y NO hace el UPDATE', async () => {
    query.mockResolvedValueOnce({ rows: [filaGeovisor()] }); // getById
    obtenerConfig.mockResolvedValueOnce({ id: 'config-1' });
    listarFeaturesConCompletitud.mockResolvedValueOnce({ resumen: resumenCompleto({ completas: 2, incompletas: 3 }) });

    await expect(toggleActivo('geovisor-1', true)).rejects.toMatchObject({
      status: 409,
      code: 'GEOVISOR_INCOMPLETO',
      fields: { publicable: false },
    });
    expect(query).toHaveBeenCalledTimes(1); // solo el SELECT de getById -- nunca llegó al UPDATE
  });

  it('lanza 404 si el geovisor no existe, antes de validar nada', async () => {
    query.mockResolvedValueOnce({ rows: [] });
    await expect(toggleActivo('geovisor-x', true)).rejects.toMatchObject({ status: 404 });
  });
});
