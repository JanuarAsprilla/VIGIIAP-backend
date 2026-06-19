import rateLimit from 'express-rate-limit';

export const rateLimiter = rateLimit({
  windowMs: Number(process.env.RATE_LIMIT_WINDOW_MS) || 15 * 60 * 1000,
  // Usuarios autenticados tienen límite más generoso que anónimos
  max: (req) => (req.user ? 500 : (Number(process.env.RATE_LIMIT_MAX) || 100)),
  // Clave por usuario autenticado (previene bypass por IP compartida)
  keyGenerator: (req) => req.user?.id ?? req.ip,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Demasiadas solicitudes. Intenta de nuevo en unos minutos.' },
});

/** Rate limiter más estricto para endpoints de autenticación. */
export const authRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Demasiados intentos de autenticación. Intenta en 15 minutos.' },
});

/** Subida de archivos: máximo 10 por hora por usuario (no por IP). */
export const uploadRateLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 10,
  keyGenerator: (req) => req.user?.id ?? req.ip,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Límite de subidas alcanzado. Máximo 10 archivos por hora.' },
});

/** Descargas: máximo 60 en 5 minutos por IP. */
export const downloadRateLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Demasiadas descargas. Intenta de nuevo en unos minutos.' },
});

/** Operaciones administrativas: máximo 200 por 15 minutos por IP. */
export const adminRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 200,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Demasiadas operaciones administrativas.' },
});
