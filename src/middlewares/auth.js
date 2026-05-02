import jwt from 'jsonwebtoken';
import { isRevoked } from '../utils/tokenBlacklist.js';

/**
 * Verifica el JWT del header Authorization: Bearer <token>.
 * Adjunta req.user = { id, email, rol } si es válido y no fue revocado.
 */
export function authenticate(req, res, next) {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Token de autenticación requerido' });
  }

  const token = header.slice(7);

  if (isRevoked(token)) {
    return res.status(401).json({ error: 'Sesión cerrada. Inicia sesión nuevamente.' });
  }

  try {
    req.user = jwt.verify(token, process.env.JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ error: 'Token inválido o expirado' });
  }
}

/**
 * Intenta verificar el JWT si viene en el header, pero no bloquea si falta o es inválido.
 * Útil para rutas públicas que filtran contenido según el rol del usuario.
 */
export function optionalAuthenticate(req, res, next) {
  const header = req.headers.authorization;
  if (header?.startsWith('Bearer ')) {
    const token = header.slice(7);
    if (!isRevoked(token)) {
      try {
        req.user = jwt.verify(token, process.env.JWT_SECRET);
      } catch {
        // Token inválido/expirado — continuar como visitante
      }
    }
  }
  next();
}

/**
 * Permite acceso solo a los roles indicados.
 * Usar después de authenticate.
 * @param {...string} roles - 'super_admin', 'admin_sig', 'investigador', 'publico'
 */
export function authorize(...roles) {
  return (req, res, next) => {
    // super_admin tiene acceso a todo excepto rutas exclusivas de super_admin
    const effectiveRoles = roles.includes('admin_sig')
      ? [...roles, 'super_admin']
      : roles;
    if (!effectiveRoles.includes(req.user?.rol)) {
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
