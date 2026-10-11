import { getClient } from '../config/database.js';
import logger from './logger.js';

/**
 * Retención del registro de auditoría: se borran los eventos más antiguos pasados
 * AUDITORIA_RETENCION_DIAS (730 por defecto). La tabla es de solo anexado (migración 061); la
 * purga activa app.purga_auditoria solo dentro de su propia transacción. Se borra siempre un
 * prefijo de la cadena (por número de secuencia) para no dejar huecos en el medio.
 */
const DIAS_RETENCION = Number(process.env.AUDITORIA_RETENCION_DIAS) || 730;
const INTERVALO_MS = 24 * 60 * 60 * 1000;

let manejador = null;

export async function purgarAuditoria() {
  const cliente = await getClient();
  try {
    await cliente.query('BEGIN');
    await cliente.query("SET LOCAL app.purga_auditoria = 'on'");
    const { rowCount } = await cliente.query(
      `DELETE FROM audit_log
       WHERE secuencia <= (
         SELECT MAX(secuencia) FROM audit_log
         WHERE secuencia IS NOT NULL AND creado_en < NOW() - make_interval(days => $1)
       )`,
      [DIAS_RETENCION],
    );
    await cliente.query('COMMIT');
    if (rowCount) logger.info(`[retencionAuditoria] Eventos antiguos borrados: ${rowCount}`);
    return { eventosBorrados: rowCount ?? 0 };
  } catch (err) {
    await cliente.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    cliente.release();
  }
}

async function ejecutarSinFallar() {
  try {
    await purgarAuditoria();
  } catch (err) {
    logger.warn(`[retencionAuditoria] Error en la purga: ${err.message}`);
  }
}

/** Purga al arrancar y luego una vez al día. */
export function startRetencionAuditoria(intervaloMs = INTERVALO_MS) {
  stopRetencionAuditoria();
  ejecutarSinFallar();
  manejador = setInterval(ejecutarSinFallar, intervaloMs);
  manejador.unref?.();
  return manejador;
}

export function stopRetencionAuditoria() {
  if (manejador) {
    clearInterval(manejador);
    manejador = null;
  }
}
