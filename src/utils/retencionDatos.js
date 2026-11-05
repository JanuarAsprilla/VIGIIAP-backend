import { query } from '../config/database.js';
import logger from './logger.js';
import { conBloqueo } from './bloqueoTareas.js';

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

/**
 * Retención del resto de registros con datos personales (principio de temporalidad, Ley 1581 art. 4).
 * Sesiones vencidas, accesos de visitante y errores se purgan por omisión. Los registros de custodia
 * (descargas, archivos escaneados) solo se purgan si se configura un plazo: borrarlos es irreversible y el
 * plazo debe aprobarlo el IIAP (docs/cumplimiento/INVENTARIO_RNBD.md). 0 o ausente = no purgar.
 */
function dias(variable, porOmision) {
  const crudo = process.env[variable];
  const valor = Number(crudo);
  return crudo !== undefined && crudo !== '' && Number.isFinite(valor) && valor >= 0 ? valor : porOmision;
}

export async function purgarRegistros() {
  const resultado = {};
  const borrar = async (clave, sql, plazo) => {
    if (!plazo) return;
    const r = await query(sql, [plazo]);
    resultado[clave] = r.rowCount ?? 0;
  };

  await borrar('sesiones',
    `DELETE FROM refresh_tokens
     WHERE expira_en < NOW() - make_interval(days => $1)
        OR (revocado AND creado_en < NOW() - make_interval(days => $1))`,
    dias('SESIONES_RETENCION_DIAS', 30));
  await borrar('visitantes',
    'DELETE FROM visitantes WHERE creado_en < NOW() - make_interval(days => $1)',
    dias('VISITANTES_RETENCION_DIAS', 90));
  await borrar('errores',
    'DELETE FROM error_log WHERE ultima_vez < NOW() - make_interval(days => $1)',
    dias('ERROR_LOG_RETENCION_DIAS', 180));
  await borrar('descargas',
    'DELETE FROM descarga_log WHERE created_at < NOW() - make_interval(days => $1)',
    dias('DESCARGAS_RETENCION_DIAS', 0));
  await borrar('custodia',
    'DELETE FROM geo_custodia WHERE created_at < NOW() - make_interval(days => $1)',
    dias('DESCARGAS_RETENCION_DIAS', 0));
  await borrar('escaneos',
    'DELETE FROM file_scan_log WHERE created_at < NOW() - make_interval(days => $1)',
    dias('ESCANEOS_RETENCION_DIAS', 0));

  const total = Object.values(resultado).reduce((suma, n) => suma + n, 0);
  if (total > 0) logger.info(`[retencionDatos] Registros purgados: ${JSON.stringify(resultado)}`);
  return resultado;
}

async function ejecutarSinFallar() {
  for (const [nombre, tarea] of [['retencion_analitica', purgarAnalitica], ['retencion_registros', purgarRegistros]]) {
    try {
      await conBloqueo(nombre, tarea);
    } catch (err) {
      logger.warn(`[retencionDatos] Error en la purga (${nombre}): ${err.message}`);
    }
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
