/**
 * Ajustes operativos que el super_admin puede cambiar desde el panel sin
 * redesplegar — cache de 5 min contra la tabla `configuracion`, mismo patrón
 * que ya usa mailer.js para SMTP. Separado de mailer.js porque estos no son
 * correo: CORS y rate limiting viven en app.js/rateLimiter.js.
 *
 * Todos son ADITIVOS a lo que ya viene de env vars — nunca reemplazan la
 * base. Así un cambio mal hecho en el panel no puede bloquear el acceso al
 * propio panel (ver getExtraCorsOrigins) ni dejar el sitio sin límite de
 * peticiones si el valor guardado es inválido (ver getRateLimitMax).
 */
import { query } from './database.js';

const DYNAMIC_KEYS = [
  'cors_extra_origins', 'rate_limit_max', 'admin_email_fallback',
  'passwordMinLength', 'require2faAdmins',
];
const PASSWORD_MIN_LENGTH_FLOOR = 8; // ver strongPassword en passwordPolicy.js -- el schema ya exige esto
const TTL_MS = 5 * 60_000;

let _cache = null;
let _cacheAt = 0;

/** Invalidado por admin.service.js apenas el super_admin guarda un cambio. */
export function clearDynamicConfigCache() {
  _cache = null;
  _cacheAt = 0;
}

async function loadConfig() {
  if (_cache && Date.now() - _cacheAt < TTL_MS) return _cache;
  try {
    const { rows } = await query(
      `SELECT clave, valor FROM configuracion WHERE clave = ANY($1::text[])`,
      [DYNAMIC_KEYS],
    );
    _cache = Object.fromEntries(rows.map((r) => [r.clave, r.valor]));
  } catch {
    // BD no disponible momentáneamente — conserva el último cache conocido
    // (podría ser null la primera vez) en vez de machacarlo con vacío.
  }
  _cacheAt = Date.now();
  return _cache || {};
}

/** Orígenes CORS extra, ADEMÁS de los ya permitidos por CORS_ORIGIN (env var). */
export async function getExtraCorsOrigins() {
  const cfg = await loadConfig();
  return (cfg.cors_extra_origins || '').split(',').map((o) => o.trim()).filter(Boolean);
}

/** Tope de peticiones del rate limiter general — null si no hay valor guardado o es inválido. */
export async function getRateLimitMax() {
  const cfg = await loadConfig();
  const n = Number(cfg.rate_limit_max);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** Correo(s) de respaldo para alertas admin cuando no hay admin_sig/super_admin activo en BD. */
export async function getAdminEmailFallback() {
  const cfg = await loadConfig();
  return cfg.admin_email_fallback || null;
}

/** Longitud mínima de contraseña configurada -- nunca por debajo del piso fijo del schema. */
export async function getPasswordMinLength() {
  const cfg = await loadConfig();
  const n = Number(cfg.passwordMinLength);
  return Number.isFinite(n) && n > PASSWORD_MIN_LENGTH_FLOOR ? n : PASSWORD_MIN_LENGTH_FLOOR;
}

/** Si está activo, admin_sig/super_admin sin 2FA quedan bloqueados hasta activarlo (ver RequireAdmin en el frontend). */
export async function getRequire2faAdmins() {
  const cfg = await loadConfig();
  return cfg.require2faAdmins === 'true';
}
