import jwt from 'jsonwebtoken';

/**
 * Verifica el JWT del header Authorization: Bearer <token>.
 * Adjunta req.user = { id, email, rol } si es válido.
 */
export function authenticate(req, res, next) {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Token de autenticación requerido' });
  }

  const token = header.slice(7);
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
    try {
      req.user = jwt.verify(header.slice(7), process.env.JWT_SECRET);
    } catch {
      // Token inválido/expirado — continuar como visitante
    }
  }
  next();
}

/**
 * Permite acceso solo a los roles indicados.
 * Usar después de authenticate.
 * @param {...string} roles - 'admin_sig', 'investigador', 'publico'
 */
export function authorize(...roles) {
  return (req, res, next) => {
    if (!roles.includes(req.user?.rol)) {
      return res.status(403).json({ error: 'No tienes permiso para esta acción' });
    }
    next();
  };
}
