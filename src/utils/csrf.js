import crypto from 'node:crypto';

/**
 * Protección CSRF — patrón "double submit" sin estado, derivado del propio
 * access token (HMAC), sin necesidad de una cookie ni almacenamiento extra.
 *
 * Por qué es necesario: aunque las cookies de sesión usan sameSite: 'Lax'
 * (ver src/utils/cookieOptions.js), esa protección depende de que el
 * navegador de cada usuario la respete — no es una garantía absoluta, y no
 * cubre casos donde el frontend y el backend vuelvan a vivir en dominios
 * distintos (ver el comentario en cookieOptions.js). El CORS estricto de
 * app.js bloquea que JavaScript de un origen no permitido pueda LEER la
 * respuesta, pero no impide que un <form> cross-site con Content-Type
 * "simple" (multipart/form-data, x-www-form-urlencoded, text/plain) dispare
 * la petición real sin preflight, ejecutando el efecto secundario en el
 * servidor si el navegador llegara a adjuntar la cookie. express.urlencoded
 * está deshabilitado, pero multer sigue parseando multipart/form-data en las
 * rutas de subida de archivos — ese es el vector real de CSRF que esta capa
 * cierra de forma explícita, sin depender del navegador.
 *
 * El token se calcula con HMAC-SHA256(JWT_SECRET + ':csrf', accessToken):
 * no requiere una cookie adicional ni tocar cada punto donde se emite la
 * cookie de sesión (login, refresh, 2FA, etc.) — el cliente lo obtiene una
 * vez vía GET /api/v1/auth/csrf-token (protegido por CORS, igual que
 * cualquier otra respuesta) y lo reenvía en el header X-CSRF-Token en cada
 * petición mutante.
 */

function deriveKey() {
  return `${process.env.JWT_SECRET}:csrf`;
}

export const CSRF_HEADER = 'x-csrf-token';

/** Calcula el token CSRF esperado para un access token dado. */
export function generateCsrfToken(accessToken) {
  return crypto.createHmac('sha256', deriveKey()).update(accessToken).digest('hex');
}

/** Compara en tiempo constante el token recibido contra el esperado. */
export function verifyCsrfToken(accessToken, provided) {
  if (!accessToken || !provided || typeof provided !== 'string') return false;

  const expected = generateCsrfToken(accessToken);
  const expectedBuf = Buffer.from(expected, 'hex');
  const providedBuf = Buffer.from(provided, 'hex');

  if (expectedBuf.length !== providedBuf.length) return false;
  return crypto.timingSafeEqual(expectedBuf, providedBuf);
}
