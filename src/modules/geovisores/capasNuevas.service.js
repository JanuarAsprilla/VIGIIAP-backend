import { query } from '../../config/database.js';
import logger from '../../utils/logger.js';

// Una capa cuenta como "nueva" durante este tiempo desde que la plataforma la vio por primera vez.
export const DIAS_CAPA_NUEVA = 7;

/**
 * Registra las capas que GeoServer publica ahora mismo y devuelve el Set de ids que son nuevas
 * (vistas por primera vez hace menos de DIAS_CAPA_NUEVA días).
 *
 * GeoServer no informa cuándo se publicó una capa, así que la fecha es "la primera vez que la
 * vimos". La primera vez que se descubre una conexión, todo lo que ya existe se guarda como línea
 * base y no cuenta como nuevo -- si no, el día del despliegue el catálogo entero saldría marcado.
 *
 * Nunca lanza: marcar capas nuevas es un extra, y un fallo aquí no debe dejar el visor sin catálogo.
 */
export async function obtenerCapasNuevas(conexionId, capaIds) {
  if (capaIds.length === 0) return new Set();
  try {
    const { rows: existentes } = await query(
      'SELECT 1 FROM capas_geoserver_vistas WHERE conexion_id = $1 LIMIT 1',
      [conexionId],
    );
    const esLineaBase = existentes.length === 0;

    await query(
      `INSERT INTO capas_geoserver_vistas (conexion_id, capa_id, es_linea_base)
       SELECT $1, UNNEST($2::text[]), $3
       ON CONFLICT (conexion_id, capa_id) DO NOTHING`,
      [conexionId, capaIds, esLineaBase],
    );
    if (esLineaBase) return new Set();

    const { rows } = await query(
      `SELECT capa_id FROM capas_geoserver_vistas
        WHERE conexion_id = $1
          AND capa_id = ANY($2::text[])
          AND es_linea_base = false
          AND primera_vez_vista > NOW() - make_interval(days => $3)`,
      [conexionId, capaIds, DIAS_CAPA_NUEVA],
    );
    return new Set(rows.map((fila) => fila.capa_id));
  } catch (err) {
    logger.warn(`[capas-nuevas] no se pudo registrar/consultar capas nuevas: ${err.message}`);
    return new Set();
  }
}
