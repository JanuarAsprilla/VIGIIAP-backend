import { query } from '../../config/database.js';
import logger from '../../utils/logger.js';

// La línea base solo cambia cuando se descubre la conexión por primera vez; un minuto evita una consulta por tile.
export const TTL_LINEA_BASE_MS = 60_000;

const cache = new Map();

/** Ids de las capas que ya existían cuando la plataforma vio la conexión por primera vez. */
export async function obtenerLineaBase(conexionId) {
  const guardada = cache.get(conexionId);
  if (guardada && guardada.expira > Date.now()) return guardada.capas;
  try {
    const { rows } = await query(
      'SELECT capa_id FROM capas_geoserver_vistas WHERE conexion_id = $1 AND es_linea_base = true',
      [conexionId],
    );
    const capas = new Set(rows.map((fila) => fila.capa_id));
    cache.set(conexionId, { capas, expira: Date.now() + TTL_LINEA_BASE_MS });
    return capas;
  } catch (err) {
    // Vacío = ninguna capa cuenta como nueva: ante la duda no se destapa nada.
    logger.warn(`[capas-nuevas] no se pudo leer la línea base: ${err.message}`);
    return new Set();
  }
}

export function invalidarLineaBase(conexionId) {
  cache.delete(conexionId);
}
