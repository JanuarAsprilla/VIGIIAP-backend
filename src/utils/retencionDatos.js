import { query } from '../config/database.js';
import logger from './logger.js';

/**
 * Retención de los datos personales de la analítica: la IP de cada sesión se borra pasado un
 * plazo corto y la sesión completa (con sus vistas, por ON DELETE CASCADE) pasado uno largo.
 * La ubicación aproximada se conserva mientras exista la sesión.
 */
const DIAS_RETENCION_IP = Number(process.env.ANALITICA_IP_RETENCION_DIAS) || 90;
const DIAS_RETENCION_SESION = Number(process.env.ANALITICA_RETENCION_DIAS) || 730;
const INTERVALO_MS = 6 * 60 * 60 * 1000;

let manejador = null;

/** Ejecuta la purga una vez. Es idempotente: repetirla no borra nada más. */
export async function purgarAnalitica() {
  const ips = await query(
    `UPDATE analytics_sessions SET ip = NULL
     WHERE ip IS NOT NULL AND primera_visita_en < NOW() - make_interval(days => $1)`,
    [DIAS_RETENCION_IP],
  );
  const sesiones = await query(
    `DELETE FROM analytics_sessions
     WHERE primera_visita_en < NOW() - make_interval(days => $1)`,
    [DIAS_RETENCION_SESION],
  );
  const resultado = { ipsBorradas: ips.rowCount ?? 0, sesionesBorradas: sesiones.rowCount ?? 0 };
  if (resultado.ipsBorradas || resultado.sesionesBorradas) {
    logger.info(`[retencionDatos] IP borradas: ${resultado.ipsBorradas}; sesiones borradas: ${resultado.sesionesBorradas}`);
  }
  return resultado;
}

async function ejecutarSinFallar() {
  try {
    await purgarAnalitica();
  } catch (err) {
    logger.warn(`[retencionDatos] Error en la purga: ${err.message}`);
  }
}

/** Purga al arrancar y luego cada 6 horas. */
export function startRetencionScheduler(intervaloMs = INTERVALO_MS) {
  stopRetencionScheduler();
  ejecutarSinFallar();
  manejador = setInterval(ejecutarSinFallar, intervaloMs);
  manejador.unref?.();
  return manejador;
}

export function stopRetencionScheduler() {
  if (manejador) {
    clearInterval(manejador);
    manejador = null;
  }
}
