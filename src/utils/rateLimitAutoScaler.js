/**
 * VIGIIAP — Ajuste automático y gradual del límite de peticiones
 * Mismo patrón que weeklyReportScheduler.js: poll periódico que revisa una
 * condición y actúa si se cumple.
 *
 * Sube rate_limit_max (el límite anónimo/por-usuario del rate limiter
 * general, ver rateLimiter.js) cuando, dentro de una ventana con tráfico
 * suficiente para ser representativa, la proporción de peticiones
 * bloqueadas supera un umbral -- señal de que el tráfico legítimo está
 * creciendo más rápido que el límite configurado.
 *
 * Deliberadamente NO baja el límite por su cuenta: bajarlo automáticamente
 * es una decisión de seguridad que debe quedar en manos de un super_admin
 * desde el panel, no de un job. Esto es un trinquete de un solo sentido,
 * acotado por un techo duro -- sigue siendo un límite real, no una puerta
 * que termina abriéndose sola sin control.
 */
import { query } from '../config/database.js';
import { snapshotAndReset } from './trafficMonitor.js';
import { clearDynamicConfigCache } from '../config/dynamicConfig.js';
import { registrarAuditoria } from './auditLog.js';
import logger from './logger.js';

const CHECK_INTERVAL_MS      = 60 * 60 * 1000; // 1 hora
const MIN_SAMPLE_SIZE        = 500;   // menos que esto en la ventana: no hay señal confiable, no se decide nada
const BLOCKED_RATE_THRESHOLD = 0.02;  // 2% de la ventana bloqueada dispara una subida
const GROWTH_FACTOR          = 1.2;   // +20% por ajuste -- gradual, no salta directo a un valor grande
const HARD_CEILING           = 5000;  // nunca sube de acá aunque el tráfico siga creciendo
const STATIC_FLOOR           = 300;   // nunca calcula desde menos que el default estático (ver rateLimiter.js)

let pollHandle = null;

async function getCurrentLimit() {
  const { rows } = await query(`SELECT valor FROM configuracion WHERE clave = 'rate_limit_max'`);
  const n = Number(rows[0]?.valor);
  return Number.isFinite(n) && n > 0 ? n : STATIC_FLOOR;
}

async function persistLimit(nuevo) {
  await query(
    `INSERT INTO configuracion (clave, valor, actualizado_en)
     VALUES ('rate_limit_max', $1, NOW())
     ON CONFLICT (clave) DO UPDATE SET valor = EXCLUDED.valor, actualizado_en = NOW()`,
    [String(nuevo)],
  );
  clearDynamicConfigCache();
}

/** Revisa la ventana de tráfico más reciente y sube rate_limit_max si corresponde. */
export async function runRateLimitAutoScaleCheck() {
  const { totalRequests, blockedRequests } = snapshotAndReset();
  if (totalRequests < MIN_SAMPLE_SIZE) return;

  const blockedRate = blockedRequests / totalRequests;
  if (blockedRate < BLOCKED_RATE_THRESHOLD) return;

  try {
    const actual = await getCurrentLimit();
    if (actual >= HARD_CEILING) {
      logger.warn(`[rateLimitAutoScaler] Tasa de bloqueo ${(blockedRate * 100).toFixed(1)}% (${blockedRequests}/${totalRequests}) pero rate_limit_max ya está en el techo (${HARD_CEILING}) -- revisar manualmente si el tráfico sigue creciendo.`);
      return;
    }

    const nuevo = Math.min(HARD_CEILING, Math.round(actual * GROWTH_FACTOR));
    if (nuevo <= actual) return;

    await persistLimit(nuevo);
    await registrarAuditoria({
      accion: 'rate_limit_auto_scale',
      modulo: 'sistema',
      descripcion: `rate_limit_max subido automáticamente de ${actual} a ${nuevo} (tasa de bloqueo ${(blockedRate * 100).toFixed(1)}% sobre ${totalRequests} peticiones en la última hora)`,
      usuarioEmail: 'sistema',
    });
    logger.info(`[rateLimitAutoScaler] rate_limit_max subido de ${actual} a ${nuevo} (tasa de bloqueo ${(blockedRate * 100).toFixed(1)}%)`);
  } catch (err) {
    logger.error(`[rateLimitAutoScaler] Error ajustando rate_limit_max: ${err.message}`);
  }
}

/** Inicia el poll periódico. Llamar una vez al arrancar el servidor. */
export function startRateLimitAutoScaler(intervalMs = CHECK_INTERVAL_MS) {
  stopRateLimitAutoScaler();
  pollHandle = setInterval(() => runRateLimitAutoScaleCheck(), intervalMs);
  pollHandle.unref?.();
  return pollHandle;
}

/** Detiene el poll periódico — usado en shutdown y en tests. */
export function stopRateLimitAutoScaler() {
  if (pollHandle) {
    clearInterval(pollHandle);
    pollHandle = null;
  }
}
