import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import { getRateLimitMax } from '../config/dynamicConfig.js';

/**
 * Normaliza IP usando el helper oficial de express-rate-limit (IPv4 e IPv6).
 *
 * CRÍTICO: en express-rate-limit v8, `ipKeyGenerator(ip, subnet?)` espera la
 * IP como STRING (`req.ip`), no el objeto `req` completo. Pasarle `req`
 * directamente hace que `net.isIPv6(req)` sea `false` (no es un string) y la
 * función retorna el objeto `req` sin modificar como "key". Como cada request
 * genera un objeto `req` distinto, el Map interno del MemoryStore nunca
 * acumula hits para la misma key — el rate limiter jamás bloquea una
 * petición, sin importar cuántas lleguen desde la misma IP real. Afecta a
 * todos los limiters que caen a la rama IP (usuarios sin sesión).
 */
function normalizeIp(req) {
  return ipKeyGenerator(req.ip);
}

// windowMs NO es dinámico a propósito: express-rate-limit lo fija al crear
// este middleware — cambiarlo en caliente exigiría destruir y recrear todo
// el limiter (y su store de conteos en memoria), perdiendo el conteo en
// curso. max sí acepta una función async re-evaluada en cada petición, así
// que solo ese valor se hizo editable desde el panel del super_admin.
//
// El bucket anónimo se comparte por IP — en una institución donde muchas
// personas salen a internet por la misma IP pública (NAT de oficina/campus),
// un límite bajo se agota con la carga normal de la SPA (varias peticiones
// en paralelo por persona, multiplicadas por todo el personal detrás de esa
// IP). 100/15min agotaba el cupo con solo unas pocas cargas de página; el
// fallback estático (si no hay valor guardado en `configuracion`) sube a 300.
export const rateLimiter = rateLimit({
  windowMs: Number(process.env.RATE_LIMIT_WINDOW_MS) || 15 * 60 * 1000,
  max: async (req) => {
    if (req.user) return 500;
    const dynamic = await getRateLimitMax();
    return dynamic ?? (Number(process.env.RATE_LIMIT_MAX) || 300);
  },
  keyGenerator: (req) => req.user?.id ?? normalizeIp(req),
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Demasiadas solicitudes. Intenta de nuevo en unos minutos.' },
});

/**
 * Rate limiter más estricto para endpoints de autenticación. Es defensa por
 * IP contra fuerza bruta distribuida entre cuentas — el freno específico por
 * cuenta objetivo vive en loginAccountRateLimiter, así que este no necesita
 * ser tan bajo como para golpear a una IP compartida por personal legítimo.
 */
export const authRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  keyGenerator: normalizeIp,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Demasiados intentos de autenticación. Intenta en 15 minutos.' },
});

/**
 * Defensa en profundidad para /login: limita también por la cuenta objetivo
 * (email normalizado), no solo por IP. authRateLimiter por sí solo puede ser
 * evadido si el proxy de borde no sobrescribe/agrega correctamente X-Forwarded-For
 * — un atacante que rote IPs (reales o spoofed) por request seguiría limitado
 * aquí porque la key es la cuenta atacada, no el origen de la petición.
 * Se aplica ADEMÁS del límite por IP existente, nunca en su lugar.
 */
export const loginAccountRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 15,
  keyGenerator: (req) => {
    const email = req.body?.email;
    return email ? `login-account:${String(email).trim().toLowerCase()}` : normalizeIp(req);
  },
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Demasiados intentos de autenticación para esta cuenta. Intenta en 15 minutos.' },
});

/** Subida de archivos: máximo 10 por hora por usuario. */
export const uploadRateLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 10,
  keyGenerator: (req) => req.user?.id ?? normalizeIp(req),
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Límite de subidas alcanzado. Máximo 10 archivos por hora.' },
});

/** Descargas: máximo 60 en 5 minutos por IP. */
export const downloadRateLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  max: 60,
  keyGenerator: normalizeIp,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Demasiadas descargas. Intenta de nuevo en unos minutos.' },
});

/** Operaciones administrativas: máximo 200 por 15 minutos por IP. */
export const adminRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 200,
  keyGenerator: normalizeIp,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Demasiadas operaciones administrativas.' },
});

/** Recuperación de contraseña: máximo 3 solicitudes por hora por email. */
export const passwordResetLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 3,
  keyGenerator: (req) => {
    const email = req.body?.email;
    return email ? `reset:${String(email).toLowerCase()}` : normalizeIp(req);
  },
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Demasiadas solicitudes de recuperación para este correo. Intenta en 1 hora.' },
});

/**
 * Registro y reenvío de verificación: máximo 5 solicitudes por hora por email
 * destino, además del límite por IP (authRateLimiter) ya existente. Sin esto,
 * un atacante con varias IPs puede "mail bombing" la bandeja de un usuario
 * específico repitiendo envíos de verificación con el mismo correo.
 */
export const emailActionRateLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 5,
  keyGenerator: (req) => {
    const email = req.body?.email;
    return email ? `email-action:${String(email).trim().toLowerCase()}` : normalizeIp(req);
  },
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Demasiadas solicitudes para este correo. Intenta en 1 hora.' },
});
