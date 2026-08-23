import rateLimit, { ipKeyGenerator } from 'express-rate-limit';

/**
 * Normaliza IP usando el helper oficial de express-rate-limit (IPv4 e IPv6).
 *
 * CRÍTICO: en express-rate-limit v8, `ipKeyGenerator(ip, subnet?)` espera la
 * IP como STRING (`req.ip`), no el objeto `req` completo. Pasarle `req`
 * directamente hace que `net.isIPv6(req)` sea `false` (no es un string) y la
 * función retorna el objeto `req` sin modificar como "key". Como cada request
 * genera un objeto `req` distinto, el Map interno del MemoryStore nunca
 * acumula hits para la misma key — el rate limiter jamás bloquea una
 * petición, sin importar cuántas lleguen desde la misma IP real. Este bug
 * desactivaba por completo authRateLimiter, downloadRateLimiter,
 * adminRateLimiter y la rama IP de rateLimiter/uploadRateLimiter/
 * passwordResetLimiter. Ver PoC y hallazgo en la auditoría de seguridad.
 */
function normalizeIp(req) {
  return ipKeyGenerator(req.ip);
}

export const rateLimiter = rateLimit({
  windowMs: Number(process.env.RATE_LIMIT_WINDOW_MS) || 15 * 60 * 1000,
  max: (req) => (req.user ? 500 : (Number(process.env.RATE_LIMIT_MAX) || 100)),
  keyGenerator: (req) => req.user?.id ?? normalizeIp(req),
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Demasiadas solicitudes. Intenta de nuevo en unos minutos.' },
});

/** Rate limiter más estricto para endpoints de autenticación. */
export const authRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  keyGenerator: normalizeIp,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Demasiados intentos de autenticación. Intenta en 15 minutos.' },
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
