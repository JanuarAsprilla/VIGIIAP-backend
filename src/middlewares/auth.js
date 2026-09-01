import jwt from 'jsonwebtoken';
import { isRevoked } from '../utils/tokenBlacklist.js';
import { COOKIE_NAME } from '../utils/cookieOptions.js';

/**
 * Extrae el JWT de la cookie HttpOnly (preferido) o del header Authorization: Bearer.
 * Devuelve null si no hay token disponible.
 */
function extractToken(req) {
  // 1. Cookie HttpOnly — inmune a XSS, prioridad cuando está presente
  if (req.cookies?.[COOKIE_NAME]) return req.cookies[COOKIE_NAME];
  // 2. Authorization: Bearer — compatibilidad con clientes API y fase de transición
  const header = req.headers.authorization;
  if (header?.startsWith('Bearer ')) return header.slice(7);
  return null;
}

/**
 * Verifica el JWT (cookie o Bearer).
 * Adjunta req.user = { id, email, rol } si es válido y no fue revocado.
 */
export function authenticate(req, res, next) {
  const token = extractToken(req);
  if (!token) {
    return res.status(401).json({ error: 'Token de autenticación requerido' });
  }

  if (isRevoked(token)) {
    return res.status(401).json({ error: 'Sesión cerrada. Inicia sesión nuevamente.' });
  }

  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET, { algorithms: ['HS256'] });
    // Rechazar tokens de scope especial (2fa, password-change) en rutas normales
    if (payload.scope && payload.scope !== 'access') {
      return res.status(401).json({ error: 'Token no válido para este endpoint' });
    }
    req.user = payload;
    next();
  } catch {
    res.status(401).json({ error: 'Token inválido o expirado' });
  }
}

/**
 * Intenta verificar el JWT si viene en cookie o header, pero no bloquea si falta o es inválido.
 * Útil para rutas públicas que filtran contenido según el rol del usuario.
 */
export function optionalAuthenticate(req, res, next) {
  const token = extractToken(req);
  if (token && !isRevoked(token)) {
    try {
      req.user = jwt.verify(token, process.env.JWT_SECRET, { algorithms: ['HS256'] });
    } catch {
      // Token inválido/expirado — continuar como anónimo
    }
  }
  next();
}

/**
 * Permite acceso solo a los roles indicados.
 * super_admin siempre pasa — está por encima de cualquier rol.
 * Usar después de authenticate.
 * @param {...string} roles - 'admin_sig', 'investigador', 'tecnico', 'institucional', 'publico'
 */
export function authorize(...roles) {
  return (req, res, next) => {
    // super_admin tiene acceso absoluto a todas las rutas protegidas
    if (req.user?.rol === 'super_admin') return next();
    if (!roles.includes(req.user?.rol)) {
      return res.status(403).json({ error: 'No tienes permiso para esta acción' });
    }
    next();
  };
}

/** Solo el super_admin puede acceder. */
export function requireSuperAdmin(req, res, next) {
  if (req.user?.rol !== 'super_admin') {
    return res.status(403).json({ error: 'Acción reservada para el Super Administrador' });
  }
  next();
}
