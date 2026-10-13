/**
 * VIGIIAP — Modo mantenimiento
 * Estado en memoria sincronizado con BD al arrancar, igual que
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

/**
 * Con el modo mantenimiento activo la plataforma entera queda en pausa: todo lo que cuelga de
 * /api/v1 responde 503, salvo lo imprescindible para que un administrador pueda entrar a
 * desactivarlo (login, renovar sesión, 2FA, recuperar contraseña) y el endpoint público de estado.
 * Las cuentas admin_sig/super_admin con sesión válida pasan siempre.
 */
const RUTAS_PERMITIDAS = [
  { metodo: 'POST', ruta: /^\/auth\/(login|refresh|logout|change-expired-password|recuperar-password|reset-password)$/ },
  { metodo: 'POST', ruta: /^\/auth\/2fa\/(confirm|verify)$/ },
  { metodo: 'GET', ruta: /^\/auth\/(me|csrf-token)$/ },
];

const ROLES_ADMIN = ['admin_sig', 'super_admin'];

/** Lo que muestra GET /estado: lo único que el frontend necesita saber sin sesión. */
export function estadoMantenimiento() {
  return { mantenimiento: state.activo, mensaje: state.activo ? state.mensaje : null };
}

export function maintenanceGate(req, res, next) {
  if (req.user && ROLES_ADMIN.includes(req.user.rol)) return next();
  if (!state.activo) return next();
  if (RUTAS_PERMITIDAS.some(({ metodo, ruta }) => metodo === req.method && ruta.test(req.path ?? ''))) return next();
  res.set?.('Retry-After', '300');
  res.status(503).json({ error: state.mensaje, maintenance: true });
}
