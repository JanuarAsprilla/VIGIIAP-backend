/**
 * fichas.service — Fichas por punto en geovisores: contenido curado
 * (foto/video/descripción) ligado a un atributo estable de una capa vectorial
 * de GeoServer. Ver el plan "Fichas por punto en geovisores" para el diseño
 * completo. Fase 1: config + CRUD de fichas + completitud. Fase 2 (este
 * archivo, ampliado): subida de medios -- imagen recomprimida de forma
 * síncrona (sharp), video transcodificado de forma asíncrona (ffmpeg, ver
 * video.transcode.js) con estado 'procesando' mientras tanto.
 */
import crypto from 'node:crypto';
import { promises as fsp } from 'node:fs';
import * as turf from '@turf/turf';
import { query } from '../../config/database.js';
import { obtenerConexionParaConector } from '../geovisores/conexionesGeoserver.service.js';
import * as geoserver from '../geovisores/geoserver.connector.js';
import { uploadFile, deletePublicFile, publicUrl } from '../../config/r2.js';
import { optimizeImage } from '../../utils/imageOptimize.js';
import * as video from './video.transcode.js';
import logger from '../../utils/logger.js';

const DESCRIPCION_MINIMA = 20;
const LIMITE_FEATURES = 2000;
const MAX_IMAGENES = 12;
const MAX_VIDEOS = 3;

function filaAConfig(fila) {
  return {
    id: fila.id,
    conexionGeoserverId: fila.conexion_geoserver_id,
    capaId: fila.capa_id,
    campoIdentificador: fila.campo_identificador,
    campoEtiqueta: fila.campo_etiqueta,
    creadoEn: fila.creado_en,
    actualizadoEn: fila.actualizado_en,
  };
}

function filaAFicha(fila) {
  return {
    id: fila.id,
    capaConfigId: fila.capa_config_id,
    valorIdentificador: fila.valor_identificador,
    titulo: fila.titulo,
    descripcion: fila.descripcion,
    creadoEn: fila.creado_en,
    actualizadoEn: fila.actualizado_en,
  };
}

/**
 * El contrato MedioFicha (VIGIIAP/src/types/index.ts) usa `url`/`miniaturaUrl`
 * en TODAS partes -- admin y visor público por igual -- nunca las keys
 * crudas de R2. Antes esta función devolvía `objectKey`/`miniaturaKey` sin
 * convertir, lo que dejaba el `<img>` del editor admin con `src` vacío
 * (descubierto en la prueba end-to-end real: la miniatura nunca cargaba
 * aunque la subida había funcionado). `url`/`miniaturaUrl` son null
 * mientras estado='procesando' (object_key todavía no existe) -- el
 * visor público y el admin filtran/ocultan según estado, esto solo
 * convierte la key a URL, nunca decide qué mostrar.
 */
function filaAMedio(fila) {
  return {
    id: fila.id,
    tipo: fila.tipo,
    estado: fila.estado,
    url: publicUrl(fila.object_key),
    miniaturaUrl: publicUrl(fila.miniatura_key),
    mime: fila.mime,
    bytes: fila.bytes,
    ancho: fila.ancho,
    alto: fila.alto,
    duracionS: fila.duracion_s,
    leyenda: fila.leyenda,
    creditos: fila.creditos,
    orden: fila.orden,
  };
}

/** Atributos reales de la capa (para poblar los <select> de identificador/etiqueta en el admin). */
export async function listarAtributos(conexionId, capaId) {
  const conexion = await obtenerConexionParaConector(conexionId);
  return geoserver.obtenerAtributosCapa(conexion, capaId);
}

export async function obtenerConfig(conexionId, capaId) {
  const { rows } = await query(
    'SELECT * FROM capas_fichas_config WHERE conexion_geoserver_id = $1 AND capa_id = $2',
    [conexionId, capaId],
  );
  if (!rows[0]) return null;

  const config = filaAConfig(rows[0]);
  const { rows: conteo } = await query(
    'SELECT COUNT(*) FROM fichas_punto WHERE capa_config_id = $1',
    [config.id],
  );
  return { ...config, totalFichas: Number(conteo[0].count) };
}

async function obtenerConfigOrThrow(configId) {
  const { rows } = await query('SELECT * FROM capas_fichas_config WHERE id = $1', [configId]);
  if (!rows[0]) throw Object.assign(new Error('Configuración de fichas no encontrada'), { status: 404 });
  return filaAConfig(rows[0]);
}

/**
 * Crea o actualiza la config de una capa. Cambiar el identificador cuando ya
 * existen fichas creadas invalidaría todo su contenido (los valores guardados
 * quedarían huérfanos) -- se bloquea con 409 en vez de permitirlo en
 * silencio.
 */
export async function upsertConfig(data, userId) {
  const { rows: existentes } = await query(
    'SELECT * FROM capas_fichas_config WHERE conexion_geoserver_id = $1 AND capa_id = $2',
    [data.conexionId, data.capaId],
  );
  const existente = existentes[0];

  if (existente && existente.campo_identificador !== data.campoIdentificador) {
    const { rows: fichas } = await query(
      'SELECT id FROM fichas_punto WHERE capa_config_id = $1 LIMIT 1',
      [existente.id],
    );
    if (fichas[0]) {
      throw Object.assign(
        new Error('No se puede cambiar el identificador: ya existen fichas creadas con el identificador actual'),
        { status: 409, code: 'IDENTIFICADOR_BLOQUEADO' },
      );
    }
  }

  const { rows } = await query(
    `INSERT INTO capas_fichas_config (conexion_geoserver_id, capa_id, campo_identificador, campo_etiqueta, creado_por)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (conexion_geoserver_id, capa_id)
     DO UPDATE SET campo_identificador = EXCLUDED.campo_identificador,
                   campo_etiqueta = EXCLUDED.campo_etiqueta,
                   actualizado_en = NOW()
     RETURNING *`,
    [data.conexionId, data.capaId, data.campoIdentificador, data.campoEtiqueta ?? null, userId],
  );
  return filaAConfig(rows[0]);
}

/** Ficha completa de un punto (con medios) o null si el punto aún no tiene ficha. */
export async function obtenerFicha(configId, valor) {
  const { rows } = await query(
    'SELECT * FROM fichas_punto WHERE capa_config_id = $1 AND valor_identificador = $2',
    [configId, valor],
  );
  if (!rows[0]) return null;

  const ficha = filaAFicha(rows[0]);
  const { rows: medios } = await query(
    `SELECT id, tipo, estado, object_key, miniatura_key, mime, bytes, ancho, alto, duracion_s, leyenda, creditos, orden
     FROM fichas_punto_medios WHERE ficha_id = $1 ORDER BY orden, creado_en`,
    [ficha.id],
  );
  return { ...ficha, medios: medios.map(filaAMedio) };
}

/** Crea la ficha si no existe, o actualiza título/descripción -- guardar nunca se bloquea por completitud. */
export async function upsertFicha(configId, valor, data, userId) {
  await obtenerConfigOrThrow(configId);

  const { rows } = await query(
    `INSERT INTO fichas_punto (capa_config_id, valor_identificador, titulo, descripcion, creado_por, actualizado_por)
     VALUES ($1, $2, $3, $4, $5, $5)
     ON CONFLICT (capa_config_id, valor_identificador)
     DO UPDATE SET titulo = EXCLUDED.titulo, descripcion = EXCLUDED.descripcion,
                   actualizado_por = EXCLUDED.actualizado_por, actualizado_en = NOW()
     RETURNING *`,
    [configId, valor, data.titulo ?? null, data.descripcion ?? '', userId],
  );
  return filaAFicha(rows[0]);
}

/**
 * Importación en lote de títulos y descripciones (p. ej. desde un Excel). El
 * frontend ya cruzó los valores contra los puntos reales de la capa, así que
 * acá no se vuelve a consultar GeoServer. Sin `sobrescribir`, una ficha que ya
 * tiene descripción no se toca -- una importación no debe pisar el trabajo ya
 * hecho a mano --, pero sí se completa una que existía vacía (creada, por
 * ejemplo, al subirle una foto primero). Un valor repetido en el archivo se
 * resuelve a favor de la última fila.
 */
export async function importarFichas(configId, { filas, sobrescribir }, userId) {
  await obtenerConfigOrThrow(configId);

  const porValor = new Map();
  for (const f of filas) porValor.set(f.valor, f);
  const duplicadasEnArchivo = filas.length - porValor.size;

  const { rows: previas } = await query(
    'SELECT valor_identificador, descripcion FROM fichas_punto WHERE capa_config_id = $1 AND valor_identificador = ANY($2::text[])',
    [configId, [...porValor.keys()]],
  );
  const descripcionPrevia = new Map(previas.map((p) => [p.valor_identificador, p.descripcion]));

  let creadas = 0;
  let actualizadas = 0;
  let omitidas = 0;
  const aEscribir = [];
  for (const fila of porValor.values()) {
    if (!descripcionPrevia.has(fila.valor)) {
      creadas += 1;
      aEscribir.push(fila);
    } else if (sobrescribir || !descripcionPrevia.get(fila.valor).trim()) {
      actualizadas += 1;
      aEscribir.push(fila);
    } else {
      omitidas += 1;
    }
  }

  if (aEscribir.length > 0) {
    await query(
      `INSERT INTO fichas_punto (capa_config_id, valor_identificador, titulo, descripcion, creado_por, actualizado_por)
       SELECT $1, t.valor, NULLIF(t.titulo, ''), t.descripcion, $5, $5
       FROM unnest($2::text[], $3::text[], $4::text[]) AS t(valor, titulo, descripcion)
       ON CONFLICT (capa_config_id, valor_identificador)
       DO UPDATE SET titulo = COALESCE(EXCLUDED.titulo, fichas_punto.titulo),
                     descripcion = EXCLUDED.descripcion,
                     actualizado_por = EXCLUDED.actualizado_por, actualizado_en = NOW()`,
      [
        configId,
        aEscribir.map((f) => f.valor),
        aEscribir.map((f) => f.titulo ?? ''),
        aEscribir.map((f) => f.descripcion),
        userId,
      ],
    );
  }

  return { creadas, actualizadas, omitidas, duplicadasEnArchivo };
}

/**
 * Borra la ficha (cascada borra sus medios en BD) y limpia sus objetos en R2
 * -- se leen las keys ANTES del DELETE (la cascada ya se llevó las filas de
 * fichas_punto_medios para cuando se podría consultar después).
 */
export async function eliminarFicha(configId, valor) {
  const { rows: fichaRows } = await query(
    'SELECT id FROM fichas_punto WHERE capa_config_id = $1 AND valor_identificador = $2',
    [configId, valor],
  );
  if (!fichaRows[0]) throw Object.assign(new Error('Ficha no encontrada'), { status: 404 });
  const fichaId = fichaRows[0].id;

  const { rows: medios } = await query(
    'SELECT object_key, miniatura_key FROM fichas_punto_medios WHERE ficha_id = $1',
    [fichaId],
  );

  await query('DELETE FROM fichas_punto WHERE id = $1', [fichaId]);
  await borrarKeysDeR2(medios);
}

function borrarKeysDeR2(medios) {
  const keys = medios.flatMap((m) => [m.object_key, m.miniatura_key]).filter(Boolean);
  return Promise.all(
    keys.map((key) => deletePublicFile(key).catch((err) => logger.warn('[r2] delete failed', { key, error: err.message }))),
  );
}

function calcularCentroide(geometry) {
  if (!geometry) return null;
  try {
    const [lng, lat] = turf.centroid({ type: 'Feature', properties: {}, geometry }).geometry.coordinates;
    return [lng, lat];
  } catch {
    return null;
  }
}

/**
 * Listado de features de la capa con su estado de completitud -- WFS
 * GetFeature restringido a identificador/etiqueta/geometría (nunca los
 * atributos completos), cruzado con las fichas ya guardadas. Sin paginar
 * (tope duro en LIMITE_FEATURES, ver plan): el filtrado/búsqueda es
 * responsabilidad del cliente.
 *
 * Contrato exacto esperado por el frontend (FeaturesFichaResponse en
 * VIGIIAP/src/types/index.ts) -- verificado contra una capa real de 319
 * features en producción:
 *   { resumen, features: FeatureFichaEstado[], sinIdentificador: FeatureSinIdentificador[], huerfanas: FichaHuerfana[] }
 * `features` NUNCA incluye las que no tienen identificador -- esas van
 * aparte en `sinIdentificador` (con el fid crudo de GeoServer, no un valor
 * agrupable). `resumen.sinIdentificador`/`resumen.huerfanas`/
 * `resumen.identificadoresDuplicados` son CONTEOS (number), no arreglos.
 */
export async function listarFeaturesConCompletitud(configId) {
  const config = await obtenerConfigOrThrow(configId);
  const conexion = await obtenerConexionParaConector(config.conexionGeoserverId);

  const total = await geoserver.contarFeaturesCapa(conexion, config.capaId);
  if (total > LIMITE_FEATURES) {
    throw Object.assign(
      new Error(`La capa tiene ${total} features -- supera el límite de ${LIMITE_FEATURES} soportado para fichas por punto`),
      { status: 422, code: 'CAPA_DEMASIADO_GRANDE' },
    );
  }

  const [coleccion, filasFichas] = await Promise.all([
    geoserver.listarFeaturesCapa(conexion, config.capaId, config.campoIdentificador, config.campoEtiqueta),
    query(
      `SELECT f.id, f.valor_identificador AS valor, f.descripcion, f.actualizado_en AS "actualizadoEn",
              COUNT(m.id) FILTER (WHERE m.estado = 'listo' AND m.tipo = 'imagen') AS n_imagenes,
              COUNT(m.id) FILTER (WHERE m.estado = 'listo' AND m.tipo = 'video') AS n_videos,
              COUNT(m.id) AS n_medios_total
       FROM fichas_punto f
       LEFT JOIN fichas_punto_medios m ON m.ficha_id = f.id
       WHERE f.capa_config_id = $1
       GROUP BY f.id`,
      [config.id],
    ),
  ]);

  const fichasPorValor = new Map(filasFichas.rows.map((f) => [f.valor, f]));

  // Agrupa los features crudos por valor de identificador -- varios features
  // de GeoServer pueden compartir el mismo valor (identificador duplicado en
  // los datos de origen); todos comparten una sola ficha, nFeatures dice cuántos.
  const gruposPorValor = new Map();
  const sinIdentificador = [];

  for (const feature of coleccion.features ?? []) {
    const valorCrudo = feature.properties?.[config.campoIdentificador];
    const valor = valorCrudo === null || valorCrudo === undefined ? '' : String(valorCrudo).trim();
    const etiqueta = config.campoEtiqueta ? (feature.properties?.[config.campoEtiqueta] ?? null) : null;

    if (!valor) {
      sinIdentificador.push({ fid: feature.id ?? null, etiqueta });
      continue;
    }

    const existente = gruposPorValor.get(valor);
    if (existente) {
      existente.nFeatures += 1;
    } else {
      gruposPorValor.set(valor, { etiqueta, centroide: calcularCentroide(feature.geometry), nFeatures: 1 });
    }
  }

  const features = [...gruposPorValor.entries()].map(([valor, grupo]) => {
    const fichaFila = fichasPorValor.get(valor);
    const tieneDescripcion = !!fichaFila && (fichaFila.descripcion ?? '').trim().length >= DESCRIPCION_MINIMA;
    const nImagenes = fichaFila ? Number(fichaFila.n_imagenes) : 0;
    const nVideos = fichaFila ? Number(fichaFila.n_videos) : 0;

    let estado;
    if (!fichaFila) estado = 'sin_ficha';
    else if (tieneDescripcion && nImagenes + nVideos > 0) estado = 'completa';
    else estado = 'incompleta';

    return {
      valor,
      etiqueta: grupo.etiqueta,
      centroide: grupo.centroide,
      nFeatures: grupo.nFeatures,
      estado,
      fichaId: fichaFila?.id ?? null,
      nImagenes,
      nVideos,
      tieneDescripcion,
      actualizadoEn: fichaFila?.actualizadoEn ?? null,
    };
  });

  const valoresValidos = new Set(gruposPorValor.keys());
  const huerfanas = filasFichas.rows
    .filter((f) => !valoresValidos.has(f.valor))
    .map((f) => ({ valor: f.valor, fichaId: f.id, nMedios: Number(f.n_medios_total) }));

  const completas = features.filter((f) => f.estado === 'completa').length;
  // 'sin_ficha' bloquea publicación igual que 'incompleta' -- se suman aquí
  // para que calcularCompletitud() en geovisores.service.js (bloqueantes =
  // resumen.incompletas + resumen.sinIdentificador) siga siendo correcto sin
  // tener que conocer el detalle de los 3 estados posibles.
  const incompletas = features.filter((f) => f.estado !== 'completa').length;
  const identificadoresDuplicados = features.filter((f) => f.nFeatures > 1).length;

  return {
    resumen: {
      totalFeatures: features.length,
      completas,
      incompletas,
      sinIdentificador: sinIdentificador.length,
      identificadoresDuplicados,
      huerfanas: huerfanas.length,
    },
    features,
    sinIdentificador,
    huerfanas,
  };
}

/**
 * Obtiene la ficha o la crea vacía si el punto todavía no tenía una --
 * subir el primer medio de un punto nunca debe exigir que el admin haya
 * guardado antes una descripción. `DO UPDATE SET ... = fichas_punto...`
 * (en vez de DO NOTHING) es el truco para que ON CONFLICT igual devuelva la
 * fila existente vía RETURNING, sin pisar su título/descripción ya guardados.
 */
async function obtenerOCrearFicha(configId, valor, userId) {
  const { rows } = await query(
    `INSERT INTO fichas_punto (capa_config_id, valor_identificador, creado_por, actualizado_por)
     VALUES ($1, $2, $3, $3)
     ON CONFLICT (capa_config_id, valor_identificador)
     DO UPDATE SET capa_config_id = fichas_punto.capa_config_id
     RETURNING *`,
    [configId, valor, userId],
  );
  return filaAFicha(rows[0]);
}

async function contarMedios(fichaId, tipo) {
  const { rows } = await query(
    `SELECT COUNT(*) FROM fichas_punto_medios WHERE ficha_id = $1 AND tipo = $2 AND estado != 'error'`,
    [fichaId, tipo],
  );
  return Number(rows[0].count);
}

/**
 * Sube la foto de una ficha: recompresión síncrona con sharp (imagen de
 * exhibición ~2000px + miniatura 480px), estado 'listo' de inmediato -- a
 * diferencia de video, una imagen se procesa dentro de la misma petición.
 */
export async function crearMedioImagen({ configId, valor, archivoPath, leyenda, creditos, userId }) {
  await obtenerConfigOrThrow(configId);
  const ficha = await obtenerOCrearFicha(configId, valor, userId);

  const totalImagenes = await contarMedios(ficha.id, 'imagen');
  if (totalImagenes >= MAX_IMAGENES) {
    await fsp.rm(archivoPath, { force: true });
    throw Object.assign(new Error(`Esta ficha ya tiene el máximo de ${MAX_IMAGENES} imágenes`), { status: 422, code: 'LIMITE_MEDIOS' });
  }

  let bufferOriginal;
  try {
    bufferOriginal = await fsp.readFile(archivoPath);
  } finally {
    await fsp.rm(archivoPath, { force: true }).catch(() => {});
  }

  const [principal, miniatura] = await Promise.all([
    optimizeImage(bufferOriginal, 'fichaImagen'),
    optimizeImage(bufferOriginal, 'thumbnail'),
  ]);

  const folder = `fichas/${ficha.id}`;
  const objectKey = `${folder}/${Date.now()}-${crypto.randomUUID()}.${principal.ext}`;
  const miniaturaKey = `${folder}/${Date.now()}-${crypto.randomUUID()}-thumb.${miniatura.ext}`;

  await Promise.all([
    uploadFile(objectKey, principal.buffer, principal.mimetype, true),
    uploadFile(miniaturaKey, miniatura.buffer, miniatura.mimetype, true),
  ]);

  const { rows } = await query(
    `INSERT INTO fichas_punto_medios
       (ficha_id, tipo, estado, object_key, miniatura_key, mime, bytes, ancho, alto, leyenda, creditos, orden, creado_por)
     VALUES ($1, 'imagen', 'listo', $2, $3, $4, $5, $6, $7, $8, $9,
       (SELECT COALESCE(MAX(orden) + 1, 0) FROM fichas_punto_medios WHERE ficha_id = $1), $10)
     RETURNING *`,
    [ficha.id, objectKey, miniaturaKey, principal.mimetype, principal.buffer.byteLength, principal.width, principal.height, leyenda ?? null, creditos ?? null, userId],
  );
  return filaAMedio(rows[0]);
}

/**
 * Crea el registro del video en estado 'procesando' y responde de inmediato
 * -- la transcodificación (puede tardar más que el timeout de una petición
 * HTTP) corre en segundo plano vía procesarVideoEnSegundoPlano(), sin await.
 */
export async function crearMedioVideo({ configId, valor, archivoPath, posterPath, bytes, leyenda, creditos, userId }) {
  await obtenerConfigOrThrow(configId);
  const ficha = await obtenerOCrearFicha(configId, valor, userId);

  const totalVideos = await contarMedios(ficha.id, 'video');
  if (totalVideos >= MAX_VIDEOS) {
    await Promise.all([
      fsp.rm(archivoPath, { force: true }),
      posterPath ? fsp.rm(posterPath, { force: true }) : Promise.resolve(),
    ]);
    throw Object.assign(new Error(`Esta ficha ya tiene el máximo de ${MAX_VIDEOS} videos`), { status: 422, code: 'LIMITE_MEDIOS' });
  }

  const { rows } = await query(
    `INSERT INTO fichas_punto_medios (ficha_id, tipo, estado, bytes, leyenda, creditos, orden, creado_por)
     VALUES ($1, 'video', 'procesando', $2, $3, $4,
       (SELECT COALESCE(MAX(orden) + 1, 0) FROM fichas_punto_medios WHERE ficha_id = $1), $5)
     RETURNING *`,
    [ficha.id, bytes, leyenda ?? null, creditos ?? null, userId],
  );
  const medio = filaAMedio(rows[0]);

  procesarVideoEnSegundoPlano({ medioId: medio.id, archivoPath, posterPath }).catch((err) => {
    // No debería llegar aquí -- procesarVideoEnSegundoPlano ya atrapa sus propios
    // errores y marca estado='error'. Red de seguridad para no dejar un rejection
    // sin manejar si algo falla fuera de ese try (p.ej. el propio query de error).
    logger.error('[fichas] procesarVideoEnSegundoPlano sin capturar', { medioId: medio.id, error: err.message });
  });

  return medio;
}

/**
 * Transcodifica el video subido (H.264/AAC, <=1080p), genera un poster si el
 * cliente no mandó uno, sube ambos a R2 y marca el medio 'listo' -- o 'error'
 * si algo falla. Corre después de haber respondido al cliente, nunca se
 * espera desde el controller.
 */
// Exportada solo para poder probarla de forma determinista (await directo) en
// vez de depender del timing de la llamada fire-and-forget de crearMedioVideo.
export async function procesarVideoEnSegundoPlano({ medioId, archivoPath, posterPath }) {
  const outputPath = `${archivoPath}-transcodificado.mp4`;
  let posterFinalPath = posterPath;

  try {
    await video.transcodificarVideo(archivoPath, outputPath);
    const metadatos = await video.obtenerMetadatosVideo(outputPath);

    if (!posterFinalPath) {
      posterFinalPath = `${archivoPath}-poster.jpg`;
      await video.extraerPosterFrame(outputPath, posterFinalPath);
    }

    const [bufferVideo, bufferPoster] = await Promise.all([
      fsp.readFile(outputPath),
      fsp.readFile(posterFinalPath),
    ]);
    const posterOptimizado = await optimizeImage(bufferPoster, 'thumbnail');

    const folder = `fichas/${medioId}`;
    const videoKey = `${folder}/${crypto.randomUUID()}.mp4`;
    const posterKey = `${folder}/${crypto.randomUUID()}-poster.${posterOptimizado.ext}`;

    await Promise.all([
      uploadFile(videoKey, bufferVideo, 'video/mp4', true),
      uploadFile(posterKey, posterOptimizado.buffer, posterOptimizado.mimetype, true),
    ]);

    await query(
      `UPDATE fichas_punto_medios
       SET estado = 'listo', object_key = $1, miniatura_key = $2, mime = 'video/mp4', bytes = $3, ancho = $4, alto = $5, duracion_s = $6
       WHERE id = $7`,
      [videoKey, posterKey, bufferVideo.byteLength, metadatos.ancho, metadatos.alto, metadatos.duracionS, medioId],
    );
  } catch (err) {
    logger.error('[fichas] Error transcodificando video', { medioId, error: err.message });
    await query(`UPDATE fichas_punto_medios SET estado = 'error' WHERE id = $1`, [medioId])
      .catch((errUpdate) => logger.error('[fichas] No se pudo marcar estado=error', { medioId, error: errUpdate.message }));
  } finally {
    await Promise.all([
      fsp.rm(archivoPath, { force: true }),
      fsp.rm(outputPath, { force: true }),
      posterFinalPath ? fsp.rm(posterFinalPath, { force: true }) : Promise.resolve(),
    ]).catch(() => {});
  }
}

export async function actualizarMedio(medioId, data) {
  const campos = [];
  const valores = [];
  let indice = 1;

  if (data.leyenda !== undefined) { campos.push(`leyenda = $${indice}`); valores.push(data.leyenda); indice += 1; }
  if (data.creditos !== undefined) { campos.push(`creditos = $${indice}`); valores.push(data.creditos); indice += 1; }
  if (data.orden !== undefined) { campos.push(`orden = $${indice}`); valores.push(data.orden); indice += 1; }

  valores.push(medioId);
  const { rows } = await query(
    `UPDATE fichas_punto_medios SET ${campos.join(', ')} WHERE id = $${indice} RETURNING *`,
    valores,
  );
  if (!rows[0]) throw Object.assign(new Error('Medio no encontrado'), { status: 404 });
  return filaAMedio(rows[0]);
}

/** Reordena los medios de una ficha -- valida que TODOS los ids pertenezcan a ella antes de tocar nada. */
export async function reordenarMedios(configId, valor, ids) {
  const { rows: fichaRows } = await query(
    'SELECT id FROM fichas_punto WHERE capa_config_id = $1 AND valor_identificador = $2',
    [configId, valor],
  );
  if (!fichaRows[0]) throw Object.assign(new Error('Ficha no encontrada'), { status: 404 });
  const fichaId = fichaRows[0].id;

  const { rows: medios } = await query('SELECT id FROM fichas_punto_medios WHERE ficha_id = $1', [fichaId]);
  const idsValidos = new Set(medios.map((m) => m.id));
  if (!ids.every((id) => idsValidos.has(id))) {
    throw Object.assign(new Error('Alguno de los medios no pertenece a esta ficha'), { status: 422 });
  }

  await Promise.all(ids.map((id, orden) => query('UPDATE fichas_punto_medios SET orden = $1 WHERE id = $2', [orden, id])));
}

export async function eliminarMedio(medioId) {
  const { rows } = await query(
    'DELETE FROM fichas_punto_medios WHERE id = $1 RETURNING object_key, miniatura_key',
    [medioId],
  );
  if (!rows[0]) throw Object.assign(new Error('Medio no encontrado'), { status: 404 });
  await borrarKeysDeR2(rows);
}

/**
 * Adjunta `ficha: {...} | null` a cada feature de una colección WFS ya
 * consultada por el visor público -- llamado desde
 * geovisores.service.js#consultarCapaDeGeovisor solo cuando la capa tiene el
 * modo "fichas por punto" habilitado (capasConFicha). Si la capa no tiene
 * config todavía (invariante rota, o config borrada manualmente) devuelve la
 * colección tal cual, sin romper el visor -- compatibilidad hacia atrás.
 *
 * Batch (nunca N+1): una sola query para las fichas + una para sus medios,
 * sin importar cuántos features traiga la colección.
 */
export async function adjuntarFichasAFeatures(conexionGeoserverId, capaId, coleccion) {
  if (!coleccion?.features?.length) return coleccion;

  const { rows: configRows } = await query(
    'SELECT * FROM capas_fichas_config WHERE conexion_geoserver_id = $1 AND capa_id = $2',
    [conexionGeoserverId, capaId],
  );
  const config = configRows[0];
  if (!config) return coleccion;

  const valores = [...new Set(
    coleccion.features
      .map((feature) => feature.properties?.[config.campo_identificador])
      .filter((v) => v !== null && v !== undefined)
      .map((v) => String(v).trim())
      .filter(Boolean),
  )];

  // Ojo: aunque no haya ninguna ficha guardada (o ningún feature con
  // identificador), el contrato dice que TODO feature gana un miembro
  // `ficha` (objeto o null) cuando la capa tiene el modo habilitado -- por
  // eso estos casos vacíos solo saltan las queries, nunca el mapeo final.
  const fichas = valores.length
    ? (await query('SELECT * FROM fichas_punto WHERE capa_config_id = $1 AND valor_identificador = ANY($2)', [config.id, valores])).rows
    : [];

  const medios = fichas.length
    ? (await query('SELECT * FROM fichas_punto_medios WHERE ficha_id = ANY($1) ORDER BY orden, creado_en', [fichas.map((f) => f.id)])).rows
    : [];
  const mediosPorFicha = new Map();
  for (const medio of medios) {
    const lista = mediosPorFicha.get(medio.ficha_id) ?? [];
    lista.push(filaAMedio(medio));
    mediosPorFicha.set(medio.ficha_id, lista);
  }

  const fichaPorValor = new Map(fichas.map((f) => [f.valor_identificador, f]));

  const features = coleccion.features.map((feature) => {
    const valorCrudo = feature.properties?.[config.campo_identificador];
    const valor = valorCrudo === null || valorCrudo === undefined ? '' : String(valorCrudo).trim();
    const fichaFila = valor ? fichaPorValor.get(valor) : undefined;
    return {
      ...feature,
      ficha: fichaFila
        ? { id: fichaFila.id, titulo: fichaFila.titulo, descripcion: fichaFila.descripcion, medios: mediosPorFicha.get(fichaFila.id) ?? [] }
        : null,
    };
  });

  return { ...coleccion, features };
}
