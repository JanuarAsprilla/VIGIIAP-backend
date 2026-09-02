/**
 * VIGIIAP — Reporte semanal de actividad
 * Mismo patrón que maintenanceMode.js: estado en memoria hidratado desde BD,
 * refrescado por un poll periódico en vez de una consulta por request.
 *
 * El "reloj" es el propio poll horario: en cada tick se relee reportesSemanal
 * (por si un admin lo apagó) y se envía si es lunes (UTC) y han pasado al
 * menos 6 días desde el último envío — sin fijar una hora exacta, para no
 * depender de que un tick caiga justo en un minuto concreto tras un reinicio.
 */
import { query } from '../config/database.js';
import { getReporte, getAdminEmails } from '../modules/admin/admin.service.js';
import { notifyReporteSemanal } from './mailer.js';
import logger from './logger.js';

const CHECK_INTERVAL_MS   = 60 * 60 * 1000;
const ENVIO_DIA_SEMANA    = 1; // lunes — Date#getUTCDay(): 0=domingo
const MIN_DIAS_ENTRE_ENVIOS = 6;

const state = { activo: false, ultimoEnvio: null };
let pollHandle = null;

/** Carga el estado desde BD. Se llama al arrancar y en cada tick del poll. */
export async function loadWeeklyReportState() {
  try {
    const { rows } = await query(
      "SELECT clave, valor FROM configuracion WHERE clave = ANY($1::text[])",
      [['reportesSemanal', 'reportesSemanalUltimoEnvio']],
    );
    const found = Object.fromEntries(rows.map((r) => [r.clave, r.valor]));
    state.activo      = found.reportesSemanal === 'true';
    state.ultimoEnvio = found.reportesSemanalUltimoEnvio ? new Date(found.reportesSemanalUltimoEnvio) : null;
  } catch (err) {
    logger.warn(`[weeklyReportScheduler] Error cargando estado, asumiendo desactivado: ${err.message}`);
  }
}

function debeEnviarAhora(now) {
  if (!state.activo) return false;
  if (now.getUTCDay() !== ENVIO_DIA_SEMANA) return false;
  if (!state.ultimoEnvio) return true;
  const diasDesdeUltimoEnvio = (now - state.ultimoEnvio) / (1000 * 60 * 60 * 24);
  return diasDesdeUltimoEnvio >= MIN_DIAS_ENTRE_ENVIOS;
}

async function persistirUltimoEnvio(fecha) {
  await query(
    `INSERT INTO configuracion (clave, valor, actualizado_en)
     VALUES ('reportesSemanalUltimoEnvio', $1, NOW())
     ON CONFLICT (clave) DO UPDATE SET valor = EXCLUDED.valor, actualizado_en = NOW()`,
    [fecha.toISOString()],
  );
}

/** Revisa si toca enviar el reporte semanal y lo envía a todos los admins. */
export async function runWeeklyReportCheck(now = new Date()) {
  await loadWeeklyReportState();
  if (!debeEnviarAhora(now)) return;

  try {
    const reporte     = await getReporte({ periodo: 'semana' });
    const adminEmails = await getAdminEmails();

    await Promise.all(
      adminEmails.map((adminEmail) =>
        notifyReporteSemanal({ adminEmail, reporte }).catch((err) =>
          logger.error(`[weeklyReportScheduler] Error enviando a ${adminEmail}: ${err.message}`),
        ),
      ),
    );

    state.ultimoEnvio = now;
    await persistirUltimoEnvio(now);
    logger.info(`[weeklyReportScheduler] Reporte semanal enviado a ${adminEmails.length} admin(s)`);
  } catch (err) {
    logger.error(`[weeklyReportScheduler] Error generando/enviando el reporte semanal: ${err.message}`);
  }
}

/** Inicia el poll periódico. Llamar una vez al arrancar el servidor. */
export function startWeeklyReportScheduler(intervalMs = CHECK_INTERVAL_MS) {
  stopWeeklyReportScheduler();
  pollHandle = setInterval(() => runWeeklyReportCheck(), intervalMs);
  pollHandle.unref?.();
  return pollHandle;
}

/** Detiene el poll periódico — usado en shutdown y en tests. */
export function stopWeeklyReportScheduler() {
  if (pollHandle) {
    clearInterval(pollHandle);
    pollHandle = null;
  }
}
