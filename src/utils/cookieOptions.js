/**
 * Opciones centralizadas para la cookie HttpOnly de autenticación JWT.
 *
 * - httpOnly:  el navegador nunca expone la cookie a JavaScript → inmune a XSS
 * - secure:    solo se envía por HTTPS en producción
 * - sameSite:  'Strict' previene CSRF (la cookie no se manda en peticiones cross-site)
 * - maxAge:    coincide con la vida del JWT (7 días por defecto)
 *
 * El nombre 'vigiiap_token' es el que el frontend busca al activar USE_COOKIE_AUTH.
 */
export const COOKIE_NAME = 'vigiiap_token';

/**
 * Devuelve las opciones de res.cookie() para el token de sesión.
 * @param {number} [maxAgeMs] - Duración en milisegundos. Por defecto 7 días.
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
