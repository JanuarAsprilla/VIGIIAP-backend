import { loginSchema, registerSchema, recoverSchema, resetPasswordSchema } from './auth.schema.js';
import * as authService from './auth.service.js';
import {
  notifyVerificacionEmail,
  notifyRegistroRecibido,
  notifyAdminNewRegistro,
  notifyAdminUsuarioVerificado,
  notifyRecuperarPassword,
} from '../../utils/mailer.js';
import { getAdminEmails } from '../admin/admin.service.js';
import { revokeToken } from '../../utils/tokenBlacklist.js';
import { COOKIE_NAME, authCookieOptions, clearCookieOptions } from '../../utils/cookieOptions.js';
import logger from '../../utils/logger.js';

/** POST /api/auth/logout — invalida el token actual y limpia la cookie */
export async function logout(req, res, next) {
  try {
    const token = req.cookies?.[COOKIE_NAME] ?? req.headers.authorization?.slice(7);
    if (token) {
      const exp = req.user?.exp ?? (Math.floor(Date.now() / 1000) + 8 * 3600);
      await revokeToken(token, exp);
    }
    if (req.user?.id) {
      await authService.revokeAllRefreshTokens(req.user.id).catch(() => {});
    }
    res.clearCookie(COOKIE_NAME, clearCookieOptions());
    res.json({ message: 'Sesión cerrada correctamente.' });
  } catch (err) { next(err); }
}

/** POST /api/auth/refresh — renueva access token usando refresh token */
export async function refresh(req, res, next) {
  try {
    const { refreshToken } = req.body ?? {};
    if (!refreshToken || typeof refreshToken !== 'string') {
      return res.status(400).json({ error: 'refreshToken requerido' });
    }
    const ip        = req.ip;
    const userAgent = req.headers['user-agent'];
    const tokens    = await authService.refreshTokens(refreshToken, { ip, userAgent });

    res.cookie(COOKIE_NAME, tokens.accessToken, authCookieOptions());
    res.json({ token: tokens.accessToken, refreshToken: tokens.refreshToken });
  } catch (err) { next(err); }
}

export async function login(req, res, next) {
  try {
    const data      = loginSchema.parse(req.body);
    const ip        = req.ip;
    const userAgent = req.headers['user-agent'];
    const result    = await authService.login(data.email, data.password, ip, userAgent);

    // Establecer cookie HttpOnly — el frontend puede ignorar result.token cuando
    // USE_COOKIE_AUTH = true; lo devolvemos igual para compatibilidad en la transición.
    res.cookie(COOKIE_NAME, result.token, authCookieOptions());

    res.json(result);
  } catch (err) {
    next(err);
  }
}

/** POST /api/auth/visitante — acceso rápido sin credenciales */
export async function visitante(req, res, next) {
  try {
    // Validar nombre: opcional pero, si se proporciona, debe ser texto corto
    const { nombre } = req.body ?? {};
    if (nombre !== undefined && nombre !== null) {
      if (typeof nombre !== 'string' || nombre.length > 100) {
        return res.status(400).json({ error: 'El campo nombre debe ser texto de máximo 100 caracteres.' });
      }
    }
    const ip        = req.ip;
    const userAgent = req.headers['user-agent'];
    const result    = await authService.loginVisitante({ nombre, ip, userAgent });

    // Visitante también recibe cookie — duración 8h (coincide con el JWT)
    res.cookie(COOKIE_NAME, result.token, authCookieOptions(8 * 60 * 60 * 1000));

    res.json(result);
  } catch (err) {
    next(err);
  }
}

export async function register(req, res, next) {
  try {
    const data = registerSchema.parse(req.body);
    const user = await authService.register(data);

    // Responder al cliente antes de los emails (no bloquear la respuesta)
    res.status(201).json({
      message: 'Revisa tu correo electrónico para verificar tu cuenta.',
      user: { id: user.id, nombre: user.nombre, email: user.email },
    });

    // Enviar email de verificación al usuario (fuera del try del response)
    logger.info(`[auth] Enviando email de verificación a ${user.email}`);
    notifyVerificacionEmail({
      email:             user.email,
      nombre:            user.nombre,
      verificationToken: user.verificationToken,
    }).catch((err) => logger.error(`[auth] Error email verificación a ${user.email}:`, err.message));

    // Notificar a los admins del nuevo registro
    getAdminEmails().then((adminEmails) => {
      adminEmails.forEach((adminEmail) =>
        notifyAdminNewRegistro({
          adminEmail,
          nombre:      user.nombre,
          email:       user.email,
          institucion: data.institucion,
          motivo:      data.motivo,
        }).catch((err) => logger.error(`[auth] Error email admin registro:`, err.message))
      );
    }).catch((err) => logger.error(`[auth] Error obteniendo emails admin:`, err.message));

  } catch (err) {
    next(err);
  }
}

/** GET /api/auth/verificar-email/:token */
export async function verifyEmail(req, res, next) {
  try {
    const result = await authService.verifyEmail(req.params.token);

    // Notificar solo si es verificación nueva (no si ya estaba verificado)
    if (!result.alreadyVerified) {
      const activationUrl = `${process.env.FRONTEND_URL || 'https://vigiiap.iiap.gov.co'}/admin/usuarios`;

      // 1. Confirmar al usuario que su correo fue verificado y que espere activación
      notifyRegistroRecibido({ email: result.email, nombre: result.nombre })
        .catch((err) => logger.error(`[auth] Error email registro recibido a ${result.email}:`, err.message));

      // 2. Notificar a todos los admins con botón de activación directa
      getAdminEmails().then((adminEmails) => {
        adminEmails.forEach((adminEmail) =>
          notifyAdminUsuarioVerificado({
            adminEmail,
            nombre:        result.nombre,
            email:         result.email,
            activationUrl,
          }).catch((err) => logger.error(`[auth] Error email admin verificado a ${adminEmail}:`, err.message))
        );
      }).catch((err) => logger.error(`[auth] Error obteniendo emails admin (verifyEmail):`, err.message));
    }

    res.json({
      message: result.alreadyVerified
        ? 'Tu correo ya estaba verificado.'
        : 'Correo verificado correctamente. Un administrador revisará tu acceso.',
      alreadyVerified: result.alreadyVerified,
    });
  } catch (err) {
    next(err);
  }
}

/** POST /api/auth/reenviar-verificacion */
export async function reenviarVerificacion(req, res, next) {
  try {
    const { email } = req.body ?? {};
    if (!email) return res.status(400).json({ message: 'Email requerido' });

    const result = await authService.reenviarVerificacion(email);

    // Si hay resultado, enviar email (si no, respuesta genérica)
    if (result) {
      notifyVerificacionEmail({
        email:             result.email,
        nombre:            result.nombre,
        verificationToken: result.verificationToken,
      });
    }

    // Respuesta genérica para no revelar si el email existe
    res.json({ message: 'Si el correo existe y no está verificado, recibirás un enlace.' });
  } catch (err) {
    next(err);
  }
}

/** POST /api/auth/recuperar-password */
export async function recuperarPassword(req, res, next) {
  try {
    const { email } = recoverSchema.parse(req.body);
    const result    = await authService.solicitarRecuperacion(email);

    if (result) {
      notifyRecuperarPassword({
        email:      result.email,
        nombre:     result.nombre,
        resetToken: result.resetToken,
      });
    }

    // Respuesta genérica para no revelar si el email existe
    res.json({ message: 'Si el correo está registrado, recibirás las instrucciones.' });
  } catch (err) {
    next(err);
  }
}

/** POST /api/auth/reset-password */
export async function resetPassword(req, res, next) {
  try {
    const { token, password } = resetPasswordSchema.parse(req.body);
    await authService.resetPassword(token, password);
    res.json({ message: 'Contraseña actualizada correctamente.' });
  } catch (err) {
    next(err);
  }
}

export async function me(req, res, next) {
  try {
    if (req.user?.tipo === 'visitante') {
      return res.json({
        id:     req.user.visitanteId,
        nombre: 'Visitante',
        email:  null,
        rol:    'visitante',
        tipo:   'visitante',
      });
    }
    const user = await authService.getProfile(req.user.id);
    res.json(user);
  } catch (err) {
    next(err);
  }
}
