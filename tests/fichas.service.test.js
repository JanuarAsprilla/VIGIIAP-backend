/**
 * Tests unitarios de fichas.service.js — fase 1 de "Fichas por punto en
 * geovisores" (config de capa + CRUD de fichas + listado de completitud).
 * La subida de medios (estado='procesando'/'error', object_key real) llega
 * en una fase posterior; aquí fichas_punto_medios siempre está vacía o con
 * medios ya 'listo'.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../src/config/database.js', () => ({
  query: vi.fn(),
}));
vi.mock('../src/modules/geovisores/conexionesGeoserver.service.js', () => ({
  obtenerConexionParaConector: vi.fn(),
}));
vi.mock('../src/modules/geovisores/geoserver.connector.js', () => ({
  obtenerAtributosCapa: vi.fn(),
  contarFeaturesCapa: vi.fn(),
  listarFeaturesCapa: vi.fn(),
}));

import { query } from '../src/config/database.js';
import { obtenerConexionParaConector } from '../src/modules/geovisores/conexionesGeoserver.service.js';
import * as geoserver from '../src/modules/geovisores/geoserver.connector.js';
import {
  listarAtributos, obtenerConfig, upsertConfig, obtenerFicha, upsertFicha,
  eliminarFicha, listarFeaturesConCompletitud,
} from '../src/modules/fichas/fichas.service.js';

const conexion = { id: 'conexion-1', url: 'https://geoserver.test.local/geoserver' };

function filaConfig(overrides = {}) {
  return {
    id: 'config-1',
    conexion_geoserver_id: 'conexion-1',
    capa_id: 't_19_clima:estaciones',
    campo_identificador: 'codigo_estacion',
    campo_etiqueta: 'nombre_estacion',
    creado_en: new Date().toISOString(),
    actualizado_en: new Date().toISOString(),
    ...overrides,
  };
}

beforeEach(() => {
  vi.mocked(query).mockReset();
  vi.mocked(obtenerConexionParaConector).mockReset().mockResolvedValue(conexion);
  vi.mocked(geoserver.obtenerAtributosCapa).mockReset();
  vi.mocked(geoserver.contarFeaturesCapa).mockReset();
  vi.mocked(geoserver.listarFeaturesCapa).mockReset();
});

describe('listarAtributos()', () => {
  it('resuelve la conexión y delega al conector', async () => {
    geoserver.obtenerAtributosCapa.mockResolvedValueOnce([{ nombre: 'codigo_estacion', tipo: 'xsd:string' }]);

    const atributos = await listarAtributos('conexion-1', 't_19_clima:estaciones');

    expect(obtenerConexionParaConector).toHaveBeenCalledWith('conexion-1');
    expect(geoserver.obtenerAtributosCapa).toHaveBeenCalledWith(conexion, 't_19_clima:estaciones');
    expect(atributos).toEqual([{ nombre: 'codigo_estacion', tipo: 'xsd:string' }]);
  });
});

describe('obtenerConfig()', () => {
  it('devuelve null si no hay config para esa conexión+capa', async () => {
    query.mockResolvedValueOnce({ rows: [] });

    expect(await obtenerConfig('conexion-1', 't_19_clima:estaciones')).toBeNull();
  });

  it('incluye totalFichas cuando la config existe', async () => {
    query
      .mockResolvedValueOnce({ rows: [filaConfig()] })
      .mockResolvedValueOnce({ rows: [{ count: '7' }] });

    const config = await obtenerConfig('conexion-1', 't_19_clima:estaciones');

    expect(config).toMatchObject({ id: 'config-1', campoIdentificador: 'codigo_estacion', totalFichas: 7 });
  });
});

describe('upsertConfig()', () => {
  it('crea la config cuando no existe ninguna previa', async () => {
    query
      .mockResolvedValueOnce({ rows: [] }) // SELECT existente
      .mockResolvedValueOnce({ rows: [filaConfig()] }); // INSERT ... ON CONFLICT

    const config = await upsertConfig({
      conexionId: 'conexion-1', capaId: 't_19_clima:estaciones', campoIdentificador: 'codigo_estacion',
    }, 'user-1');

    expect(config.campoIdentificador).toBe('codigo_estacion');
  });

  it('permite cambiar el identificador si la config existente NO tiene fichas', async () => {
    query
      .mockResolvedValueOnce({ rows: [filaConfig({ campo_identificador: 'id_antiguo' })] })
      .mockResolvedValueOnce({ rows: [] }) // sin fichas
      .mockResolvedValueOnce({ rows: [filaConfig({ campo_identificador: 'codigo_estacion' })] });

    const config = await upsertConfig({
      conexionId: 'conexion-1', capaId: 't_19_clima:estaciones', campoIdentificador: 'codigo_estacion',
    }, 'user-1');

    expect(config.campoIdentificador).toBe('codigo_estacion');
  });

  it('lanza 409 IDENTIFICADOR_BLOQUEADO si ya existen fichas con el identificador actual', async () => {
    query
      .mockResolvedValueOnce({ rows: [filaConfig({ campo_identificador: 'id_antiguo' })] })
      .mockResolvedValueOnce({ rows: [{ id: 'ficha-1' }] }); // sí hay fichas

    await expect(upsertConfig({
      conexionId: 'conexion-1', capaId: 't_19_clima:estaciones', campoIdentificador: 'codigo_estacion',
    }, 'user-1')).rejects.toMatchObject({ status: 409, code: 'IDENTIFICADOR_BLOQUEADO' });
  });

  it('no valida nada si el identificador enviado es el mismo que ya tenía', async () => {
    query
      .mockResolvedValueOnce({ rows: [filaConfig()] })
      .mockResolvedValueOnce({ rows: [filaConfig()] });

    await upsertConfig({
      conexionId: 'conexion-1', capaId: 't_19_clima:estaciones', campoIdentificador: 'codigo_estacion',
    }, 'user-1');

    // Solo 2 queries (SELECT existente + INSERT/UPDATE) -- no se consultó fichas_punto.
    expect(query).toHaveBeenCalledTimes(2);
  });
});

describe('obtenerFicha()', () => {
  it('devuelve null si el punto no tiene ficha', async () => {
    query.mockResolvedValueOnce({ rows: [] });

    expect(await obtenerFicha('config-1', 'EST-001')).toBeNull();
  });

  it('devuelve la ficha con sus medios', async () => {
    query
      .mockResolvedValueOnce({ rows: [{ id: 'ficha-1', capa_config_id: 'config-1', valor_identificador: 'EST-001', titulo: 'Estación 1', descripcion: 'Una descripción larga de la estación', creado_en: new Date().toISOString(), actualizado_en: new Date().toISOString() }] })
      .mockResolvedValueOnce({ rows: [{ id: 'medio-1', tipo: 'imagen', estado: 'listo', object_key: 'k1', miniatura_key: 'm1', mime: 'image/webp', bytes: 1000, ancho: 800, alto: 600, duracion_s: null, leyenda: null, creditos: null, orden: 0 }] });

    const ficha = await obtenerFicha('config-1', 'EST-001');

    expect(ficha.valorIdentificador).toBe('EST-001');
    expect(ficha.medios).toHaveLength(1);
    expect(ficha.medios[0]).toMatchObject({ tipo: 'imagen', estado: 'listo', objectKey: 'k1' });
  });
});

describe('upsertFicha()', () => {
  it('lanza 404 si la config no existe', async () => {
    query.mockResolvedValueOnce({ rows: [] }); // obtenerConfigOrThrow

    await expect(upsertFicha('config-inexistente', 'EST-001', { descripcion: 'x' }, 'user-1'))
      .rejects.toMatchObject({ status: 404 });
  });

  it('crea/actualiza la ficha sin exigir un mínimo de descripción (guardar nunca se bloquea)', async () => {
    query
      .mockResolvedValueOnce({ rows: [filaConfig()] }) // obtenerConfigOrThrow
      .mockResolvedValueOnce({ rows: [{ id: 'ficha-1', capa_config_id: 'config-1', valor_identificador: 'EST-001', titulo: null, descripcion: 'corta', creado_en: new Date().toISOString(), actualizado_en: new Date().toISOString() }] });

    const ficha = await upsertFicha('config-1', 'EST-001', { descripcion: 'corta' }, 'user-1');

    expect(ficha.descripcion).toBe('corta');
  });
});

describe('eliminarFicha()', () => {
  it('lanza 404 si no existía ninguna ficha con ese identificador', async () => {
    query.mockResolvedValueOnce({ rowCount: 0 });

    await expect(eliminarFicha('config-1', 'EST-999')).rejects.toMatchObject({ status: 404 });
  });

  it('borra la ficha existente', async () => {
    query.mockResolvedValueOnce({ rowCount: 1 });

    await expect(eliminarFicha('config-1', 'EST-001')).resolves.toBeUndefined();
  });
});

describe('listarFeaturesConCompletitud()', () => {
  function mockConfigYConexion(config = filaConfig()) {
    query.mockResolvedValueOnce({ rows: [config] }); // obtenerConfigOrThrow
  }

  it('lanza 422 CAPA_DEMASIADO_GRANDE si supera el límite de 2000 features', async () => {
    mockConfigYConexion();
    geoserver.contarFeaturesCapa.mockResolvedValueOnce(2001);

    await expect(listarFeaturesConCompletitud('config-1'))
      .rejects.toMatchObject({ status: 422, code: 'CAPA_DEMASIADO_GRANDE' });
  });

  it('marca completa=true solo si tiene descripción >=20 caracteres Y al menos un medio listo', async () => {
    mockConfigYConexion();
    geoserver.contarFeaturesCapa.mockResolvedValueOnce(2);
    geoserver.listarFeaturesCapa.mockResolvedValueOnce({
      type: 'FeatureCollection',
      features: [
        { properties: { codigo_estacion: 'EST-001', nombre_estacion: 'Uno' }, geometry: { type: 'Point', coordinates: [-76.6, 5.55] } },
        { properties: { codigo_estacion: 'EST-002', nombre_estacion: 'Dos' }, geometry: { type: 'Point', coordinates: [-76.7, 5.56] } },
      ],
    });
    query.mockResolvedValueOnce({
      rows: [
        { valor: 'EST-001', titulo: 'Uno', descripcion: 'Una descripción con más de veinte caracteres', actualizadoEn: new Date().toISOString(), medios: '2' },
        { valor: 'EST-002', titulo: 'Dos', descripcion: 'corta', actualizadoEn: new Date().toISOString(), medios: '0' },
      ],
    });

    const resultado = await listarFeaturesConCompletitud('config-1');

    expect(resultado.resumen).toMatchObject({ totalFeatures: 2, completas: 1, incompletas: 1, sinIdentificador: 0 });
    expect(resultado.features.find((f) => f.valor === 'EST-001').completa).toBe(true);
    expect(resultado.features.find((f) => f.valor === 'EST-002').completa).toBe(false);
  });

  it('cuenta features sin identificador y detecta identificadores duplicados', async () => {
    mockConfigYConexion();
    geoserver.contarFeaturesCapa.mockResolvedValueOnce(3);
    geoserver.listarFeaturesCapa.mockResolvedValueOnce({
      type: 'FeatureCollection',
      features: [
        { properties: { codigo_estacion: null }, geometry: { type: 'Point', coordinates: [-76.6, 5.55] } },
        { properties: { codigo_estacion: 'EST-DUP' }, geometry: { type: 'Point', coordinates: [-76.7, 5.56] } },
        { properties: { codigo_estacion: 'EST-DUP' }, geometry: { type: 'Point', coordinates: [-76.8, 5.57] } },
      ],
    });
    query.mockResolvedValueOnce({ rows: [] });

    const resultado = await listarFeaturesConCompletitud('config-1');

    expect(resultado.resumen.sinIdentificador).toBe(1);
    expect(resultado.resumen.identificadoresDuplicados).toEqual(['EST-DUP']);
  });

  it('detecta fichas huérfanas (existen en BD pero ya no aparecen en la capa)', async () => {
    mockConfigYConexion();
    geoserver.contarFeaturesCapa.mockResolvedValueOnce(1);
    geoserver.listarFeaturesCapa.mockResolvedValueOnce({
      type: 'FeatureCollection',
      features: [{ properties: { codigo_estacion: 'EST-001' }, geometry: { type: 'Point', coordinates: [-76.6, 5.55] } }],
    });
    query.mockResolvedValueOnce({
      rows: [
        { valor: 'EST-001', titulo: 'Uno', descripcion: 'x', actualizadoEn: new Date().toISOString(), medios: '0' },
        { valor: 'EST-BORRADA-EN-GEOSERVER', titulo: 'Vieja', descripcion: 'x', actualizadoEn: new Date().toISOString(), medios: '1' },
      ],
    });

    const resultado = await listarFeaturesConCompletitud('config-1');

    expect(resultado.resumen.huerfanas).toEqual(['EST-BORRADA-EN-GEOSERVER']);
  });

  it('calcula el centroide de la geometría de cada feature', async () => {
    mockConfigYConexion();
    geoserver.contarFeaturesCapa.mockResolvedValueOnce(1);
    geoserver.listarFeaturesCapa.mockResolvedValueOnce({
      type: 'FeatureCollection',
      features: [{ properties: { codigo_estacion: 'EST-001' }, geometry: { type: 'Point', coordinates: [-76.6, 5.55] } }],
    });
    query.mockResolvedValueOnce({ rows: [] });

    const resultado = await listarFeaturesConCompletitud('config-1');

    expect(resultado.features[0].centroide).toEqual([-76.6, 5.55]);
  });
});
