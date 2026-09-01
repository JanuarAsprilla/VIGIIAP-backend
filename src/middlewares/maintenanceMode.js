/**
 * VIGIIAP — Modo mantenimiento
 * Antes, activar el toggle "Modo Mantenimiento" desde Configuración no tenía
 * ningún efecto real: la clave se guardaba en BD pero nada la leía para
 * bloquear nada.
 *
 * Estrategia: estado en memoria sincronizado con BD al arrancar, igual que
 * tokenBlacklist.js — el middleware es síncrono y no golpea BD en cada
 * request; adminService.setConfiguracion() actualiza este estado en memoria
 * en el momento en que un super_admin guarda el cambio, así que el efecto
 * es inmediato sin esperar caché ni reinicio.
 *
 * Ese camino rápido no cubre una edición directa de `configuracion` por SQL
 * (fuera del panel admin) — sin refresco periódico, ese cambio se queda en
 * BD pero sin efecto real hasta el próximo reinicio del proceso. Por eso
 * startMaintenanceStatePolling() vuelve a hidratar el estado cada cierto
 * tiempo, cerrando esa ventana sin convertir el gate en una consulta a BD
 * por request.
 */
import { query } from '../config/database.js';
import logger from '../utils/logger.js';

const DEFAULT_MENSAJE = 'La plataforma está en mantenimiento. Vuelve a intentarlo más tarde.';
const POLL_INTERVAL_MS = 30_000;

const state = { activo: false, mensaje: DEFAULT_MENSAJE };
let pollHandle = null;

/** Carga el estado desde BD al arrancar el servidor. */
export async function loadMaintenanceState() {
  try {
    const { rows } = await query(
      "SELECT clave, valor FROM configuracion WHERE clave = ANY($1::text[])",
      [['modoMantenimiento', 'mensajeMantenimiento']],
    );
    const found = Object.fromEntries(rows.map((r) => [r.clave, r.valor]));
    state.activo  = found.modoMantenimiento === 'true';
    state.mensaje = found.mensajeMantenimiento || DEFAULT_MENSAJE;
    logger.info(`[maintenanceMode] Estado cargado — activo=${state.activo}`);
  } catch (err) {
    logger.warn(`[maintenanceMode] Error cargando estado, asumiendo desactivado: ${err.message}`);
  }
}

/** Re-hidrata el estado desde BD a intervalos regulares — ver nota arriba. */
export function startMaintenanceStatePolling(intervalMs = POLL_INTERVAL_MS) {
  stopMaintenanceStatePolling();
  pollHandle = setInterval(loadMaintenanceState, intervalMs);
  pollHandle.unref?.();
  return pollHandle;
}

/** Detiene el refresco periódico — usado en shutdown y en tests. */
export function stopMaintenanceStatePolling() {
  if (pollHandle) {
    clearInterval(pollHandle);
    pollHandle = null;
  }
}

/** Actualiza el estado en memoria — llamado por adminService.setConfiguracion(). */
export function setMaintenanceState({ modoMantenimiento, mensajeMantenimiento }) {
  if (modoMantenimiento !== undefined) {
    state.activo = modoMantenimiento === true || modoMantenimiento === 'true';
  }
  if (mensajeMantenimiento !== undefined) {
    state.mensaje = mensajeMantenimiento || DEFAULT_MENSAJE;
  }
}

/** Aplica a rutas de contenido público — admin_sig/super_admin siempre pasan. */
export function maintenanceGate(req, res, next) {
  if (req.user && ['admin_sig', 'super_admin'].includes(req.user.rol)) return next();
  if (!state.activo) return next();
  res.status(503).json({ error: state.mensaje, maintenance: true });
}
