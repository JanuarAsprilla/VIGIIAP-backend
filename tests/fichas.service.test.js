/**
 * Tests unitarios de fichas.service.js — "Fichas por punto en geovisores".
 * Fase 1: config de capa + CRUD de fichas + completitud. Fase 2: subida de
 * medios (imagen síncrona, video asíncrono con estado 'procesando'/'error').
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

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
vi.mock('../src/config/r2.js', () => ({
  uploadFile: vi.fn(),
  deletePublicFile: vi.fn().mockResolvedValue(undefined),
  publicUrl: vi.fn((key) => (key ? `https://files.test.local/${key}` : null)),
}));
vi.mock('../src/modules/fichas/video.transcode.js', () => ({
  transcodificarVideo: vi.fn(),
  extraerPosterFrame: vi.fn(),
  obtenerMetadatosVideo: vi.fn(),
}));
vi.mock('../src/utils/imageOptimize.js', () => ({
  optimizeImage: vi.fn(),
}));

import { query } from '../src/config/database.js';
import { obtenerConexionParaConector } from '../src/modules/geovisores/conexionesGeoserver.service.js';
import * as geoserver from '../src/modules/geovisores/geoserver.connector.js';
import { uploadFile, deletePublicFile } from '../src/config/r2.js';
import * as video from '../src/modules/fichas/video.transcode.js';
import { optimizeImage } from '../src/utils/imageOptimize.js';
import {
  listarAtributos, obtenerConfig, upsertConfig, obtenerFicha, upsertFicha,
  eliminarFicha, listarFeaturesConCompletitud,
  crearMedioImagen, crearMedioVideo, actualizarMedio, reordenarMedios, eliminarMedio,
  procesarVideoEnSegundoPlano, adjuntarFichasAFeatures,
} from '../src/modules/fichas/fichas.service.js';

function crearArchivoTemporal(contenido = 'contenido de prueba') {
  const rutaArchivo = path.join(os.tmpdir(), `fichas-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  fs.writeFileSync(rutaArchivo, contenido);
  return rutaArchivo;
}

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
  vi.mocked(uploadFile).mockReset().mockResolvedValue('https://files.test.local/fichas/x.webp');
  vi.mocked(deletePublicFile).mockReset().mockResolvedValue(undefined);
  vi.mocked(video.transcodificarVideo).mockReset();
  vi.mocked(video.extraerPosterFrame).mockReset();
  vi.mocked(video.obtenerMetadatosVideo).mockReset();
  vi.mocked(optimizeImage).mockReset();
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
    expect(ficha.medios[0]).toMatchObject({ tipo: 'imagen', estado: 'listo', url: 'https://files.test.local/k1' });
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
    query.mockResolvedValueOnce({ rows: [] }); // SELECT id

    await expect(eliminarFicha('config-1', 'EST-999')).rejects.toMatchObject({ status: 404 });
  });

  it('borra la ficha y limpia los objetos de R2 de sus medios', async () => {
    query
      .mockResolvedValueOnce({ rows: [{ id: 'ficha-1' }] }) // SELECT id
      .mockResolvedValueOnce({ rows: [{ object_key: 'fichas/1/foto.webp', miniatura_key: 'fichas/1/foto-thumb.webp' }] }) // SELECT medios
      .mockResolvedValueOnce({ rowCount: 1 }); // DELETE

    await expect(eliminarFicha('config-1', 'EST-001')).resolves.toBeUndefined();

    expect(deletePublicFile).toHaveBeenCalledWith('fichas/1/foto.webp');
    expect(deletePublicFile).toHaveBeenCalledWith('fichas/1/foto-thumb.webp');
  });

  it('no falla si un medio no tenía object_key/miniatura_key (video todavía procesando)', async () => {
    query
      .mockResolvedValueOnce({ rows: [{ id: 'ficha-1' }] })
      .mockResolvedValueOnce({ rows: [{ object_key: null, miniatura_key: null }] })
      .mockResolvedValueOnce({ rowCount: 1 });

    await expect(eliminarFicha('config-1', 'EST-001')).resolves.toBeUndefined();
    expect(deletePublicFile).not.toHaveBeenCalled();
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

  it('estado=completa solo si tiene descripción >=20 caracteres Y al menos un medio listo', async () => {
    mockConfigYConexion();
    geoserver.contarFeaturesCapa.mockResolvedValueOnce(2);
    geoserver.listarFeaturesCapa.mockResolvedValueOnce({
      type: 'FeatureCollection',
      features: [
        { id: 'f.1', properties: { codigo_estacion: 'EST-001', nombre_estacion: 'Uno' }, geometry: { type: 'Point', coordinates: [-76.6, 5.55] } },
        { id: 'f.2', properties: { codigo_estacion: 'EST-002', nombre_estacion: 'Dos' }, geometry: { type: 'Point', coordinates: [-76.7, 5.56] } },
      ],
    });
    query.mockResolvedValueOnce({
      rows: [
        { id: 'ficha-1', valor: 'EST-001', descripcion: 'Una descripción con más de veinte caracteres', actualizadoEn: new Date().toISOString(), n_imagenes: '2', n_videos: '0', n_medios_total: '2' },
        { id: 'ficha-2', valor: 'EST-002', descripcion: 'corta', actualizadoEn: new Date().toISOString(), n_imagenes: '0', n_videos: '0', n_medios_total: '0' },
      ],
    });

    const resultado = await listarFeaturesConCompletitud('config-1');

    expect(resultado.resumen).toMatchObject({ totalFeatures: 2, completas: 1, incompletas: 1, sinIdentificador: 0 });
    expect(resultado.features.find((f) => f.valor === 'EST-001')).toMatchObject({ estado: 'completa', fichaId: 'ficha-1', nImagenes: 2 });
    expect(resultado.features.find((f) => f.valor === 'EST-002')).toMatchObject({ estado: 'incompleta', fichaId: 'ficha-2' });
  });

  it('estado=sin_ficha cuando el valor no tiene ninguna ficha guardada (distinto de incompleta)', async () => {
    mockConfigYConexion();
    geoserver.contarFeaturesCapa.mockResolvedValueOnce(1);
    geoserver.listarFeaturesCapa.mockResolvedValueOnce({
      type: 'FeatureCollection',
      features: [{ id: 'f.1', properties: { codigo_estacion: 'EST-NUEVA' }, geometry: { type: 'Point', coordinates: [-76.6, 5.55] } }],
    });
    query.mockResolvedValueOnce({ rows: [] });

    const resultado = await listarFeaturesConCompletitud('config-1');

    expect(resultado.features[0]).toMatchObject({ estado: 'sin_ficha', fichaId: null, tieneDescripcion: false });
    expect(resultado.resumen.incompletas).toBe(1); // sin_ficha también bloquea publicación
  });

  it('features sin identificador van en `sinIdentificador` (con el fid crudo), no en `features`', async () => {
    mockConfigYConexion();
    geoserver.contarFeaturesCapa.mockResolvedValueOnce(2);
    geoserver.listarFeaturesCapa.mockResolvedValueOnce({
      type: 'FeatureCollection',
      features: [
        { id: 'Estaciones.1', properties: { codigo_estacion: null, nombre_estacion: 'Sin código' }, geometry: { type: 'Point', coordinates: [-76.6, 5.55] } },
        { id: 'Estaciones.2', properties: { codigo_estacion: 'EST-001' }, geometry: { type: 'Point', coordinates: [-76.7, 5.56] } },
      ],
    });
    query.mockResolvedValueOnce({ rows: [] });

    const resultado = await listarFeaturesConCompletitud('config-1');

    expect(resultado.resumen.sinIdentificador).toBe(1);
    expect(resultado.sinIdentificador).toEqual([{ fid: 'Estaciones.1', etiqueta: 'Sin código' }]);
    expect(resultado.features.find((f) => f.valor === '')).toBeUndefined(); // nunca aparece en `features`
    expect(resultado.features).toHaveLength(1);
  });

  it('agrupa features con el mismo identificador (nFeatures>1) y lo cuenta como duplicado', async () => {
    mockConfigYConexion();
    geoserver.contarFeaturesCapa.mockResolvedValueOnce(2);
    geoserver.listarFeaturesCapa.mockResolvedValueOnce({
      type: 'FeatureCollection',
      features: [
        { id: 'f.1', properties: { codigo_estacion: 'EST-DUP' }, geometry: { type: 'Point', coordinates: [-76.7, 5.56] } },
        { id: 'f.2', properties: { codigo_estacion: 'EST-DUP' }, geometry: { type: 'Point', coordinates: [-76.8, 5.57] } },
      ],
    });
    query.mockResolvedValueOnce({ rows: [] });

    const resultado = await listarFeaturesConCompletitud('config-1');

    expect(resultado.resumen.identificadoresDuplicados).toBe(1); // 1 identificador distinto duplicado, no 2 filas
    expect(resultado.features).toHaveLength(1); // se agrupan en una sola entrada
    expect(resultado.features[0]).toMatchObject({ valor: 'EST-DUP', nFeatures: 2 });
  });

  it('detecta fichas huérfanas (existen en BD pero ya no aparecen en la capa) con conteo de medios', async () => {
    mockConfigYConexion();
    geoserver.contarFeaturesCapa.mockResolvedValueOnce(1);
    geoserver.listarFeaturesCapa.mockResolvedValueOnce({
      type: 'FeatureCollection',
      features: [{ id: 'f.1', properties: { codigo_estacion: 'EST-001' }, geometry: { type: 'Point', coordinates: [-76.6, 5.55] } }],
    });
    query.mockResolvedValueOnce({
      rows: [
        { id: 'ficha-1', valor: 'EST-001', descripcion: 'x', actualizadoEn: new Date().toISOString(), n_imagenes: '0', n_videos: '0', n_medios_total: '0' },
        { id: 'ficha-vieja', valor: 'EST-BORRADA-EN-GEOSERVER', descripcion: 'x', actualizadoEn: new Date().toISOString(), n_imagenes: '1', n_videos: '0', n_medios_total: '1' },
      ],
    });

    const resultado = await listarFeaturesConCompletitud('config-1');

    expect(resultado.resumen.huerfanas).toBe(1);
    expect(resultado.huerfanas).toEqual([{ valor: 'EST-BORRADA-EN-GEOSERVER', fichaId: 'ficha-vieja', nMedios: 1 }]);
  });

  it('calcula el centroide de la geometría de cada feature', async () => {
    mockConfigYConexion();
    geoserver.contarFeaturesCapa.mockResolvedValueOnce(1);
    geoserver.listarFeaturesCapa.mockResolvedValueOnce({
      type: 'FeatureCollection',
      features: [{ id: 'f.1', properties: { codigo_estacion: 'EST-001' }, geometry: { type: 'Point', coordinates: [-76.6, 5.55] } }],
    });
    query.mockResolvedValueOnce({ rows: [] });

    const resultado = await listarFeaturesConCompletitud('config-1');

    expect(resultado.features[0].centroide).toEqual([-76.6, 5.55]);
  });
});

function filaFicha(overrides = {}) {
  return {
    id: 'ficha-1', capa_config_id: 'config-1', valor_identificador: 'EST-001',
    titulo: null, descripcion: '', creado_en: new Date().toISOString(), actualizado_en: new Date().toISOString(),
    ...overrides,
  };
}

describe('crearMedioImagen()', () => {
  it('recomprime (principal + miniatura), sube ambas a R2, y borra el temporal', async () => {
    const archivoTmp = crearArchivoTemporal('bytes de una imagen');
    query
      .mockResolvedValueOnce({ rows: [filaConfig()] }) // obtenerConfigOrThrow
      .mockResolvedValueOnce({ rows: [filaFicha()] }) // obtenerOCrearFicha
      .mockResolvedValueOnce({ rows: [{ count: '2' }] }) // contarMedios
      .mockResolvedValueOnce({ rows: [{ id: 'medio-1', tipo: 'imagen', estado: 'listo', object_key: 'k1', miniatura_key: 'k1-thumb', mime: 'image/webp', bytes: 1234, ancho: 2000, alto: 1500, duracion_s: null, leyenda: null, creditos: null, orden: 2 }] });

    optimizeImage
      .mockResolvedValueOnce({ buffer: Buffer.from('principal'), mimetype: 'image/webp', ext: 'webp', width: 2000, height: 1500 })
      .mockResolvedValueOnce({ buffer: Buffer.from('miniatura'), mimetype: 'image/webp', ext: 'webp', width: 480, height: 360 });

    const medio = await crearMedioImagen({ configId: 'config-1', valor: 'EST-001', archivoPath: archivoTmp, userId: 'user-1' });

    expect(medio).toMatchObject({ tipo: 'imagen', estado: 'listo', url: 'https://files.test.local/k1', miniaturaUrl: 'https://files.test.local/k1-thumb' });
    expect(uploadFile).toHaveBeenCalledTimes(2);
    expect(fs.existsSync(archivoTmp)).toBe(false);
  });

  it('lanza 422 LIMITE_MEDIOS si la ficha ya tiene el máximo de imágenes, y limpia el temporal', async () => {
    const archivoTmp = crearArchivoTemporal();
    query
      .mockResolvedValueOnce({ rows: [filaConfig()] })
      .mockResolvedValueOnce({ rows: [filaFicha()] })
      .mockResolvedValueOnce({ rows: [{ count: '12' }] });

    await expect(crearMedioImagen({ configId: 'config-1', valor: 'EST-001', archivoPath: archivoTmp, userId: 'user-1' }))
      .rejects.toMatchObject({ status: 422, code: 'LIMITE_MEDIOS' });
    expect(fs.existsSync(archivoTmp)).toBe(false);
  });
});

describe('crearMedioVideo()', () => {
  it('inserta el medio en estado procesando y responde de inmediato (sin esperar la transcodificación)', async () => {
    const archivoTmp = crearArchivoTemporal('bytes de video');
    query
      .mockResolvedValueOnce({ rows: [filaConfig()] })
      .mockResolvedValueOnce({ rows: [filaFicha()] })
      .mockResolvedValueOnce({ rows: [{ count: '0' }] })
      .mockResolvedValueOnce({ rows: [{ id: 'medio-1', tipo: 'video', estado: 'procesando', object_key: null, miniatura_key: null, mime: null, bytes: 5000, ancho: null, alto: null, duracion_s: null, leyenda: null, creditos: null, orden: 0 }] })
      .mockResolvedValue({ rows: [{}], rowCount: 1 }); // red de seguridad para lo que dispare el job en background

    video.transcodificarVideo.mockResolvedValue(undefined);
    video.obtenerMetadatosVideo.mockResolvedValue({ ancho: 1920, alto: 1080, duracionS: 5 });
    optimizeImage.mockResolvedValue({ buffer: Buffer.from('poster'), mimetype: 'image/webp', ext: 'webp', width: 480, height: 270 });

    const medio = await crearMedioVideo({ configId: 'config-1', valor: 'EST-001', archivoPath: archivoTmp, posterPath: undefined, bytes: 5000, userId: 'user-1' });

    expect(medio).toMatchObject({ tipo: 'video', estado: 'procesando' });
  });

  it('lanza 422 LIMITE_MEDIOS si la ficha ya tiene el máximo de videos, y limpia archivo + poster temporales', async () => {
    const archivoTmp = crearArchivoTemporal();
    const posterTmp = crearArchivoTemporal();
    query
      .mockResolvedValueOnce({ rows: [filaConfig()] })
      .mockResolvedValueOnce({ rows: [filaFicha()] })
      .mockResolvedValueOnce({ rows: [{ count: '3' }] });

    await expect(crearMedioVideo({ configId: 'config-1', valor: 'EST-001', archivoPath: archivoTmp, posterPath: posterTmp, bytes: 1000, userId: 'user-1' }))
      .rejects.toMatchObject({ status: 422, code: 'LIMITE_MEDIOS' });
    expect(fs.existsSync(archivoTmp)).toBe(false);
    expect(fs.existsSync(posterTmp)).toBe(false);
  });
});

describe('procesarVideoEnSegundoPlano() (job de transcodificación)', () => {
  it('éxito sin poster del cliente: genera uno del frame, sube video+poster, marca estado=listo', async () => {
    const archivoTmp = crearArchivoTemporal('entrada-cruda');
    video.transcodificarVideo.mockImplementationOnce(async (_input, output) => fs.writeFileSync(output, 'video-transcodificado'));
    video.obtenerMetadatosVideo.mockResolvedValueOnce({ ancho: 1920, alto: 1080, duracionS: 12.5 });
    video.extraerPosterFrame.mockImplementationOnce(async (_videoPath, outputImagePath) => fs.writeFileSync(outputImagePath, 'frame-extraido'));
    optimizeImage.mockResolvedValueOnce({ buffer: Buffer.from('poster-optimizado'), mimetype: 'image/webp', ext: 'webp', width: 480, height: 270 });
    query.mockResolvedValueOnce({ rowCount: 1 });

    await procesarVideoEnSegundoPlano({ medioId: 'medio-1', archivoPath: archivoTmp, posterPath: undefined });

    expect(video.extraerPosterFrame).toHaveBeenCalledOnce();
    expect(uploadFile).toHaveBeenCalledTimes(2);
    const [sql, params] = query.mock.calls.at(-1);
    expect(sql).toMatch(/estado = 'listo'/);
    expect(params).toContain(1920);
    expect(params).toContain(1080);
    expect(fs.existsSync(archivoTmp)).toBe(false);
  });

  it('con poster del cliente: no genera uno nuevo del frame', async () => {
    const archivoTmp = crearArchivoTemporal('entrada');
    const posterTmp = crearArchivoTemporal('poster-del-cliente');
    video.transcodificarVideo.mockImplementationOnce(async (_input, output) => fs.writeFileSync(output, 'video'));
    video.obtenerMetadatosVideo.mockResolvedValueOnce({ ancho: 1280, alto: 720, duracionS: 3 });
    optimizeImage.mockResolvedValueOnce({ buffer: Buffer.from('poster-opt'), mimetype: 'image/webp', ext: 'webp', width: 480, height: 270 });
    query.mockResolvedValueOnce({ rowCount: 1 });

    await procesarVideoEnSegundoPlano({ medioId: 'medio-1', archivoPath: archivoTmp, posterPath: posterTmp });

    expect(video.extraerPosterFrame).not.toHaveBeenCalled();
  });

  it('en error de ffmpeg: marca estado=error y limpia los temporales igual', async () => {
    const archivoTmp = crearArchivoTemporal('entrada-corrupta');
    video.transcodificarVideo.mockRejectedValueOnce(new Error('ffmpeg salió con código 1'));
    query.mockResolvedValueOnce({ rowCount: 1 });

    await procesarVideoEnSegundoPlano({ medioId: 'medio-1', archivoPath: archivoTmp, posterPath: undefined });

    const [sql, params] = query.mock.calls.at(-1);
    expect(sql).toMatch(/estado = 'error'/);
    expect(params).toEqual(['medio-1']);
    expect(fs.existsSync(archivoTmp)).toBe(false);
  });
});

describe('actualizarMedio()', () => {
  it('actualiza solo los campos enviados (SET dinámico)', async () => {
    query.mockResolvedValueOnce({
      rows: [{ id: 'medio-1', tipo: 'imagen', estado: 'listo', object_key: 'k', miniatura_key: 'k2', mime: 'image/webp', bytes: 1, ancho: 1, alto: 1, duracion_s: null, leyenda: 'nueva', creditos: null, orden: 0 }],
    });

    const medio = await actualizarMedio('medio-1', { leyenda: 'nueva' });

    const [sql] = query.mock.calls[0];
    expect(sql).toMatch(/leyenda = \$1/);
    expect(sql).not.toMatch(/creditos/);
    expect(medio.leyenda).toBe('nueva');
  });

  it('lanza 404 si el medio no existe', async () => {
    query.mockResolvedValueOnce({ rows: [] });
    await expect(actualizarMedio('medio-x', { orden: 1 })).rejects.toMatchObject({ status: 404 });
  });
});

describe('reordenarMedios()', () => {
  it('lanza 404 si la ficha no existe', async () => {
    query.mockResolvedValueOnce({ rows: [] });
    await expect(reordenarMedios('config-1', 'EST-001', ['a'])).rejects.toMatchObject({ status: 404 });
  });

  it('rechaza 422 si algún id no pertenece a la ficha', async () => {
    query
      .mockResolvedValueOnce({ rows: [{ id: 'ficha-1' }] })
      .mockResolvedValueOnce({ rows: [{ id: 'medio-a' }, { id: 'medio-b' }] });

    await expect(reordenarMedios('config-1', 'EST-001', ['medio-a', 'medio-ajeno']))
      .rejects.toMatchObject({ status: 422 });
  });

  it('actualiza el orden de cada medio según su posición en el arreglo recibido', async () => {
    query
      .mockResolvedValueOnce({ rows: [{ id: 'ficha-1' }] })
      .mockResolvedValueOnce({ rows: [{ id: 'medio-a' }, { id: 'medio-b' }] })
      .mockResolvedValue({ rowCount: 1 });

    await reordenarMedios('config-1', 'EST-001', ['medio-b', 'medio-a']);

    const llamadasUpdate = query.mock.calls.slice(2);
    expect(llamadasUpdate).toContainEqual([expect.stringContaining('UPDATE fichas_punto_medios SET orden'), [0, 'medio-b']]);
    expect(llamadasUpdate).toContainEqual([expect.stringContaining('UPDATE fichas_punto_medios SET orden'), [1, 'medio-a']]);
  });
});

describe('eliminarMedio()', () => {
  it('lanza 404 si el medio no existe', async () => {
    query.mockResolvedValueOnce({ rows: [] });
    await expect(eliminarMedio('medio-x')).rejects.toMatchObject({ status: 404 });
  });

  it('borra el medio y limpia sus objetos en R2', async () => {
    query.mockResolvedValueOnce({ rows: [{ object_key: 'k1', miniatura_key: 'k1-thumb' }] });

    await eliminarMedio('medio-1');

    expect(deletePublicFile).toHaveBeenCalledWith('k1');
    expect(deletePublicFile).toHaveBeenCalledWith('k1-thumb');
  });
});

describe('adjuntarFichasAFeatures() (visor público)', () => {
  const coleccionBase = {
    type: 'FeatureCollection',
    features: [
      { properties: { codigo_estacion: 'EST-001' }, geometry: { type: 'Point', coordinates: [-76.6, 5.55] } },
      { properties: { codigo_estacion: 'EST-002' }, geometry: { type: 'Point', coordinates: [-76.7, 5.56] } },
    ],
  };

  it('devuelve la colección tal cual si la capa no tiene config (invariante rota, sin romper el visor)', async () => {
    query.mockResolvedValueOnce({ rows: [] }); // sin config

    const resultado = await adjuntarFichasAFeatures('conexion-1', 't_19_clima:estaciones', coleccionBase);

    expect(resultado).toBe(coleccionBase);
  });

  it('devuelve la colección tal cual si no hay features', async () => {
    const resultado = await adjuntarFichasAFeatures('conexion-1', 't_19_clima:estaciones', { type: 'FeatureCollection', features: [] });
    expect(query).not.toHaveBeenCalled();
    expect(resultado).toEqual({ type: 'FeatureCollection', features: [] });
  });

  it('adjunta ficha:null a los features sin ficha guardada', async () => {
    query
      .mockResolvedValueOnce({ rows: [filaConfig()] }) // config
      .mockResolvedValueOnce({ rows: [] }); // sin fichas para esos identificadores

    const resultado = await adjuntarFichasAFeatures('conexion-1', 't_19_clima:estaciones', coleccionBase);

    expect(resultado.features.every((f) => f.ficha === null)).toBe(true);
  });

  it('adjunta la ficha con medios convertidos a URL pública, y null en el resto', async () => {
    query
      .mockResolvedValueOnce({ rows: [filaConfig()] })
      .mockResolvedValueOnce({ rows: [{ id: 'ficha-1', valor_identificador: 'EST-001', titulo: 'Estación 1', descripcion: 'Una estación climática' }] })
      .mockResolvedValueOnce({
        rows: [
          { id: 'medio-1', ficha_id: 'ficha-1', tipo: 'imagen', estado: 'listo', object_key: 'fichas/1/foto.webp', miniatura_key: 'fichas/1/thumb.webp', mime: 'image/webp', bytes: 100, ancho: 2000, alto: 1500, duracion_s: null, leyenda: 'una leyenda', creditos: null, orden: 0 },
          { id: 'medio-2', ficha_id: 'ficha-1', tipo: 'video', estado: 'procesando', object_key: null, miniatura_key: null, mime: null, bytes: 500, ancho: null, alto: null, duracion_s: null, leyenda: null, creditos: null, orden: 1 },
        ],
      });

    const resultado = await adjuntarFichasAFeatures('conexion-1', 't_19_clima:estaciones', coleccionBase);

    const feature1 = resultado.features.find((f) => f.properties.codigo_estacion === 'EST-001');
    const feature2 = resultado.features.find((f) => f.properties.codigo_estacion === 'EST-002');

    expect(feature1.ficha).toMatchObject({ id: 'ficha-1', titulo: 'Estación 1', descripcion: 'Una estación climática' });
    expect(feature1.ficha.medios).toHaveLength(2);
    expect(feature1.ficha.medios[0]).toMatchObject({ tipo: 'imagen', estado: 'listo', url: 'https://files.test.local/fichas/1/foto.webp', miniaturaUrl: 'https://files.test.local/fichas/1/thumb.webp' });
    // Video en 'procesando': sin object_key todavía -> url null (el frontend filtra por estado, esto solo convierte la key).
    expect(feature1.ficha.medios[1]).toMatchObject({ tipo: 'video', estado: 'procesando', url: null, miniaturaUrl: null });
    expect(feature2.ficha).toBeNull();
  });
});
