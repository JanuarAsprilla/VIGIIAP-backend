/**
 * dataCustody — Cadena de custodia de datos geoespaciales y documentales.
 *
 * Implementa el principio de trazabilidad completa sobre los recursos
 * del sistema VIGIIAP: quién subió, modificó, publicó, descargó o
 * eliminó cada recurso, desde qué IP y cuándo.
 *
 * Tablas:
 *  - geo_custodia    → ciclo de vida del recurso (ingreso, edición, publicación, baja)
 *  - descarga_log    → registro de descargas (quién, cuándo, qué archivo)
 *  - file_scan_log   → resultado de la validación de archivos subidos
 *
 * En caso de fallo (BD no disponible) solo se emite una advertencia — el
 * flujo principal no se interrumpe.
 */
import { query } from '../config/database.js';
import logger from './logger.js';

// ─── Tipos de acción sobre recursos ─────────────────────────────────────────
export const ACCION = Object.freeze({
  INGRESO:        'ingreso',
  ACTUALIZACION:  'actualizacion',
  PUBLICACION:    'publicacion',
  DESPUBLICACION: 'despublicacion',
  DESCARGA:       'descarga',
  ELIMINACION:    'eliminacion',
});

// ─── Cadena de custodia — ciclo de vida del recurso ─────────────────────────

/**
 * Registra un evento en la cadena de custodia de un recurso geoespacial.
 *
 * @param {object} params
 * @param {'mapa'|'documento'}  params.tipoRecurso
 * @param {string}              params.recursoId      - UUID del recurso
 * @param {string}              params.accion         - ACCION.* constante
 * @param {string}             [params.usuarioId]
 * @param {string}             [params.usuarioEmail]
 * @param {string}             [params.ip]
 * @param {object}             [params.metadatos]     - Info adicional (hash, tamaño, CRS…)
 */
export async function registrarCustodia({
  tipoRecurso,
  recursoId,
  accion,
  usuarioId = null,
  usuarioEmail = null,
  ip = null,
  metadatos = {},
}) {
  try {
    await query(
      `INSERT INTO geo_custodia
         (tipo_recurso, recurso_id, accion, usuario_id, usuario_email, ip, metadatos)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [
        tipoRecurso,
        recursoId,
        accion,
        usuarioId,
        usuarioEmail,
        ip ? ip.replace('::ffff:', '') : null,
        JSON.stringify(metadatos),
      ],
    );
  } catch (err) {
    logger.warn(`[dataCustody] Error registrando custodia (${accion}/${tipoRecurso}/${recursoId}): ${err.message}`);
  }
}

// ─── Log de descargas ────────────────────────────────────────────────────────

/**
 * Registra una descarga de archivo en el log de descargas.
 *
 * @param {object} params
 * @param {'mapa'|'documento'} params.tipoRecurso
 * @param {string}             params.recursoId
 * @param {string}            [params.recursoTitulo]
 * @param {string}            [params.usuarioId]
 * @param {string}            [params.usuarioEmail]
 * @param {string}            [params.ip]
 * @param {string}            [params.archivoUrl]
 */
export async function registrarDescarga({
  tipoRecurso,
  recursoId,
  recursoTitulo = null,
  usuarioId = null,
  usuarioEmail = null,
  ip = null,
  archivoUrl = null,
}) {
  try {
    await query(
      `INSERT INTO descarga_log
         (tipo_recurso, recurso_id, recurso_titulo, usuario_id, usuario_email, ip, archivo_url)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [
        tipoRecurso,
        recursoId,
        recursoTitulo,
        usuarioId,
        usuarioEmail,
        ip ? ip.replace('::ffff:', '') : null,
        archivoUrl,
      ],
    );
  } catch (err) {
    logger.warn(`[dataCustody] Error registrando descarga (${tipoRecurso}/${recursoId}): ${err.message}`);
  }
}

// ─── Log de escaneo de archivos ──────────────────────────────────────────────

/**
 * Registra el resultado del escaneo de un archivo subido.
 *
 * @param {object} params
 * @param {string}  params.archivoKey    - Clave en R2 (o nombre original si fue rechazado)
 * @param {string}  params.sha256Hash    - Hash SHA-256 del buffer
 * @param {string}  params.mimeType      - MIME type declarado
 * @param {number}  params.tamanioBytes  - Tamaño en bytes
 * @param {string} [params.uploadedBy]   - UUID del usuario que subió
 * @param {string} [params.ipOrigen]
 * @param {'clean'|'rejected'|'suspicious'} params.resultado
 * @param {string} [params.detalle]      - Motivo de rechazo
 */
export async function registrarScanArchivo({
  archivoKey,
  sha256Hash,
  mimeType,
  tamanioBytes,
  uploadedBy = null,
  ipOrigen = null,
  resultado = 'clean',
  detalle = null,
}) {
  try {
    await query(
      `INSERT INTO file_scan_log
         (archivo_key, sha256_hash, mime_type, tamano_bytes, uploaded_by, ip_origen, resultado, detalle)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [
        archivoKey,
        sha256Hash,
        mimeType,
        tamanioBytes,
        uploadedBy,
        ipOrigen ? ipOrigen.replace('::ffff:', '') : null,
        resultado,
        detalle,
      ],
    );
  } catch (err) {
    logger.warn(`[dataCustody] Error registrando scan (${archivoKey}): ${err.message}`);
  }
}

// ─── Consultas de custodia (para panel admin) ────────────────────────────────

/**
 * Retorna la cadena de custodia completa de un recurso.
 * @param {'mapa'|'documento'} tipoRecurso
 * @param {string} recursoId
 */
export async function getCadenaCustodia(tipoRecurso, recursoId) {
  const { rows } = await query(
    `SELECT id, accion, usuario_email, ip, metadatos, created_at
     FROM geo_custodia
     WHERE tipo_recurso = $1 AND recurso_id = $2
     ORDER BY created_at ASC`,
    [tipoRecurso, recursoId],
  );
  return rows;
}

/**
 * Retorna las descargas de un recurso específico.
 * @param {'mapa'|'documento'} tipoRecurso
 * @param {string} recursoId
 */
export async function getDescargasRecurso(tipoRecurso, recursoId) {
  const { rows } = await query(
    `SELECT id, usuario_email, ip, archivo_url, created_at
     FROM descarga_log
     WHERE tipo_recurso = $1 AND recurso_id = $2
     ORDER BY created_at DESC`,
    [tipoRecurso, recursoId],
  );
  return rows;
}
