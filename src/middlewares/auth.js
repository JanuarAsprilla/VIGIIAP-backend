import jwt from 'jsonwebtoken';
import { isRevoked, isUserSessionRevoked } from '../utils/tokenBlacklist.js';
import { COOKIE_NAME } from '../utils/cookieOptions.js';
import { asignarUsuarioAlContexto } from '../utils/contextoPeticion.js';
import { registrarAccesoDenegado } from '../utils/accesoDenegado.js';
import {
  ROLES_CON_2FA_EXIGIDO, CODIGO_2FA_REQUERIDO, esRutaExenta2fa, incumplePolitica2fa,
} from '../utils/politica2fa.js';

/**
 * Extrae el JWT de la cookie HttpOnly (preferido) o del header Authorization: Bearer.
 * Devuelve null si no hay token disponible.
 */
function extractToken(req) {
  // 1. Cookie HttpOnly — inmune a XSS, prioridad cuando está presente
  // cookie-parser convierte «j:{...}» en objeto: solo un texto puede ser un JWT.
  const cookie = req.cookies?.[COOKIE_NAME];
  if (typeof cookie === 'string' && cookie) return cookie;
  // 2. Authorization: Bearer — compatibilidad con clientes API y fase de transición
  const header = req.headers.authorization;
  if (header?.startsWith('Bearer ')) return header.slice(7);
  return null;
}

// Un token de scope 'access' es el único que representa una sesión completa.
// Los de scope '2fa'/'password-change' solo sirven para su propio endpoint
// de confirmación — aceptarlos en cualquier otra ruta deja pasar a alguien
// que apenas completó el primer factor como si ya tuviera sesión real.
// authenticate() y optionalAuthenticate() deben compartir esta misma regla;
// que difirieran fue justo el hallazgo que esto corrige.
//
// Un token SIN scope (anterior a que existiera, o el de visitante) solo vale si trae una identidad de
// sesión real. Los demás JWT que firma el servidor con la misma clave —p.ej. el `state` del flujo OAuth,
// que lleva provider/nonce/csrf— no pueden pasar por una sesión.
function hasValidAccessScope(payload) {
  if (payload.scope) return payload.scope === 'access';
  return Boolean(payload.id && payload.rol) || (payload.tipo === 'visitante' && Boolean(payload.visitanteId));
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
    if (!hasValidAccessScope(payload)) {
      return res.status(401).json({ error: 'Token no válido para este endpoint' });
    }
    if (isUserSessionRevoked(payload)) {
      return res.status(401).json({ error: 'Sesión cerrada. Inicia sesión nuevamente.' });
    }
    req.user = payload;
  } catch {
    return res.status(401).json({ error: 'Token inválido o expirado' });
  }
  return aplicarPolitica2fa(req, res, next);
}

/**
 * Con «exigir 2FA a administradores» activa, un admin_sig/super_admin sin TOTP solo puede usar lo necesario para
 * activarlo (ver RUTAS_EXENTAS). El resto del mundo no pasa por la base de datos ni se vuelve asíncrono.
 */
function aplicarPolitica2fa(req, res, next) {
  const { user } = req;
  if (!ROLES_CON_2FA_EXIGIDO.includes(user.rol) || esRutaExenta2fa(req)) {
    asignarUsuarioAlContexto(user);
    return next();
  }
  return incumplePolitica2fa(user).then((incumple) => {
    if (incumple) {
      registrarAccesoDenegado(req, 'la política exige 2FA a administradores y esta cuenta no lo tiene activo');
      return res.status(403).json({
        error: 'Tu organización exige activar la verificación en dos pasos (2FA) para administrar la plataforma. Actívala desde tu perfil.',
        code: CODIGO_2FA_REQUERIDO,
      });
    }
    asignarUsuarioAlContexto(user);
    return next();
  }).catch(next);
}

/**
 * Intenta verificar el JWT si viene en cookie o header, pero no bloquea si falta o es inválido.
 * Útil para rutas públicas que filtran contenido según el rol del usuario.
 */
export function optionalAuthenticate(req, res, next) {
  const token = extractToken(req);
  if (!token || isRevoked(token)) return next();

  let payload;
  try {
    payload = jwt.verify(token, process.env.JWT_SECRET, { algorithms: ['HS256'] });
  } catch {
    return next(); // Token inválido/expirado — continuar como anónimo
  }
  // Mismo chequeo que authenticate(): un token de scope '2fa' o
  // 'password-change' no debe tratarse como sesión válida tampoco aquí.
  if (!hasValidAccessScope(payload) || isUserSessionRevoked(payload)) return next();

  if (!ROLES_CON_2FA_EXIGIDO.includes(payload.rol)) {
    req.user = payload;
    asignarUsuarioAlContexto(payload);
    return next();
  }
  // Un administrador que incumple la política navega como anónimo: no ve borradores ni vistas de administración.
  return incumplePolitica2fa(payload).then((incumple) => {
    if (!incumple || esRutaExenta2fa(req)) {
      req.user = payload;
      asignarUsuarioAlContexto(payload);
    }
    next();
  }).catch(next);
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
      registrarAccesoDenegado(req, `requiere rol ${roles.join(' o ')}`);
      return res.status(403).json({ error: 'No tienes permiso para esta acción' });
    }
    next();
  };
}

/** Solo el super_admin puede acceder. */
export function requireSuperAdmin(req, res, next) {
  if (req.user?.rol !== 'super_admin') {
    registrarAccesoDenegado(req, 'reservado al Super Administrador');
    return res.status(403).json({ error: 'Acción reservada para el Super Administrador' });
  }
  next();
}
