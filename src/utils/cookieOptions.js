/**
 * Opciones centralizadas para la cookie HttpOnly de autenticación JWT.
 *
 * httpOnly evita que el navegador exponga la cookie a JavaScript (inmune a
 * XSS), secure la restringe a HTTPS en producción y maxAge coincide con la
 * vida del token que protege (15 minutos para el access token, 30 días
 * para el refresh token).
 *
 * sameSite va en 'Lax' (antes 'None'): en el despliegue propio, frontend y
 * backend se sirven bajo el MISMO origen (un solo nginx en
 * vigiiap.iiap.org.co proxya / al frontend y /api/ al backend) — ya no es
 * cross-site, así que 'None' quedó siendo innecesariamente permisivo.
 * 'None' es además la marca que navegadores con protección de privacidad
 * estricta (Safari ITP, Brave Shields, Firefox modo estricto) y muchas
 * extensiones bloqueadoras de anuncios tratan con sospecha por ser el mismo
 * mecanismo que usan las cookies de rastreo cross-site — con 'Lax' la
 * plataforma deja de depender de que el navegador de cada usuario decida
 * confiar en esa marca. 'Lax' sigue enviando la cookie en la navegación
 * normal (GET de nivel superior) pero no en requests cross-site iniciados
 * por otro sitio, lo cual además refuerza (no reemplaza) la protección
 * CSRF ya existente en src/middlewares/csrf.js (token derivado por HMAC,
 * ver src/utils/csrf.js), aplicada a las rutas de estado mutante.
 *
 * Si en el futuro frontend y backend vuelven a vivir en dominios
 * distintos (ej. un CDN aparte para el frontend), este valor debe volver
 * a 'None' o la cookie de sesión dejará de enviarse en esa configuración.
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
    secure:   true,
    sameSite: 'Lax',
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
    sameSite: 'Lax',
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
    sameSite: 'Lax',
    maxAge:   days * 24 * 60 * 60 * 1000,
    path:     '/api/v1/auth/refresh',
  };
}

export function clearRefreshCookieOptions() {
  return {
    httpOnly: true,
    secure:   true,
    sameSite: 'Lax',
    path:     '/api/v1/auth/refresh',
  };
}
