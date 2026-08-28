/**
 * Opciones centralizadas para la cookie HttpOnly de autenticación JWT.
 *
 * httpOnly evita que el navegador exponga la cookie a JavaScript (inmune a
 * XSS), secure la restringe a HTTPS en producción y maxAge coincide con la
 * vida del token que protege (15 minutos para el access token, 30 días
 * para el refresh token). sameSite va en 'None' porque frontend y
 * backend viven en subdominios distintos (cross-site), lo que significa que
 * la cookie sí se envía en peticiones cross-site y por lo tanto NO mitiga
 * CSRF por sí sola — esa protección vive en src/middlewares/csrf.js (token
 * derivado por HMAC, ver src/utils/csrf.js), aplicado a las rutas de estado
 * mutante.
 *
 * El nombre 'vigiiap_token' es el que el frontend busca al activar USE_COOKIE_AUTH.
 */
export const COOKIE_NAME = 'vigiiap_token';

/**
 * Devuelve las opciones de res.cookie() para el token de sesión.
 * @param {number} [maxAgeMs] - Duración en milisegundos. Por defecto 15 minutos.
 */
export function authCookieOptions(maxAgeMs = 15 * 60 * 1000) {
  return {
    httpOnly: true,
    secure:   true,          // requerido por SameSite=None; Render siempre es HTTPS
    sameSite: 'None',        // permite cross-origin (frontend y backend en subdominios distintos)
    maxAge:   maxAgeMs,
    path:     '/',
  };
}

/**
 * Opciones para borrar la cookie en logout (maxAge=0 + mismo path/domain).
 */
export function clearCookieOptions() {
  return {
    httpOnly: true,
    secure:   true,
    sameSite: 'None',
    path:     '/',
  };
}

export const REFRESH_COOKIE_NAME = 'vigiiap_refresh';

/**
 * Opciones para la cookie del refresh token.
 * path='/api/v1/auth/refresh' → el navegador NUNCA la envía a otros endpoints.
 * Todas las rutas cuelgan de app.use('/api/v1', v1) — el path debe incluir
 * ese prefijo o la cookie nunca se adjunta a la petición real del frontend
 * (que llama a /api/v1/auth/refresh), y el refresh silencioso falla siempre
 * por falta de cookie, no por token inválido: la sesión "se cierra por
 * inactividad" a los 15 minutos (vida del access token) sin importar
 * cuánto haya usado la plataforma el usuario.
 * @param {number} [days] - Días de vida. Por defecto 30.
 */
export function refreshCookieOptions(days = 30) {
  return {
    httpOnly: true,
    secure:   true,
    sameSite: 'None',
    maxAge:   days * 24 * 60 * 60 * 1000,
    path:     '/api/v1/auth/refresh',
  };
}

export function clearRefreshCookieOptions() {
  return {
    httpOnly: true,
    secure:   true,
    sameSite: 'None',
    path:     '/api/v1/auth/refresh',
  };
}
