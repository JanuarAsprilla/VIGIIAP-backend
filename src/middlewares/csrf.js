import { COOKIE_NAME } from '../utils/cookieOptions.js';
import { verifyCsrfToken, CSRF_HEADER } from '../utils/csrf.js';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * Exige un token CSRF válido (header X-CSRF-Token) en peticiones mutantes
 * autenticadas vía la cookie httpOnly de sesión.
 *
 * Solo aplica cuando la petición trae la cookie vigiiap_token: los clientes
 * que se autentican con Authorization: Bearer (apps móviles, integraciones)
 * no dependen de un envío automático del navegador y por lo tanto no son
 * vulnerables a CSRF — quedan exentos para no romper esos flujos.
 *
 * Usar después de `authenticate`/`optionalAuthenticate` en rutas de estado
 * mutante (POST/PUT/PATCH/DELETE) bajo /admin, /usuarios, /solicitudes,
 * /mapas, /documentos, /categorias y las rutas de sesión de /auth.
 */
export function csrfProtection(req, res, next) {
  if (SAFE_METHODS.has(req.method)) return next();

  const cookieToken = req.cookies?.[COOKIE_NAME];
  // Sin cookie de sesión → autenticación por Bearer (o sin autenticar, lo
  // que ya rechaza `authenticate` más adelante). No hay riesgo CSRF.
  if (!cookieToken) return next();

  const provided = req.headers[CSRF_HEADER];
  if (!verifyCsrfToken(cookieToken, provided)) {
    return res.status(403).json({ error: 'Token CSRF inválido o ausente' });
  }
  next();
}
