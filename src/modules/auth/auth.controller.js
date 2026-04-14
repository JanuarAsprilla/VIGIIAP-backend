import { loginSchema, registerSchema, recoverSchema, resetPasswordSchema } from './auth.schema.js';
import * as authService from './auth.service.js';
import {
  notifyVerificacionEmail,
  notifyRegistroRecibido,
  notifyAdminUsuarioVerificado,
  notifyRecuperarPassword,
} from '../../utils/mailer.js';
import { getAdminEmails } from '../admin/admin.service.js';

export async function login(req, res, next) {
  try {
    const data      = loginSchema.parse(req.body);
    const ip        = req.ip || req.headers['x-forwarded-for'];
    const userAgent = req.headers['user-agent'];
    const result    = await authService.login(data.email, data.password, ip, userAgent);
    res.json(result);
  } catch (err) {
    next(err);
  }
}

/** POST /api/auth/visitante — acceso rápido sin credenciales */
export async function visitante(req, res, next) {
  try {
    const { nombre } = req.body ?? {};
    const ip        = req.ip || req.headers['x-forwarded-for'];
    const userAgent = req.headers['user-agent'];
    const result    = await authService.loginVisitante({ nombre, ip, userAgent });
    res.json(result);
  } catch (err) {
    next(err);
  }
}

export async function register(req, res, next) {
  try {
    const data = registerSchema.parse(req.body);
    const user = await authService.register(data);

    // Enviar email de verificación (prioritario — sin esto no puede ingresar)
    notifyVerificacionEmail({
      email:             user.email,
      nombre:            user.nombre,
      verificationToken: user.verificationToken,
    });

    // Notificar a todos los admins del nuevo registro (no bloqueante)
    getAdminEmails().then((adminEmails) => {
      adminEmails.forEach((adminEmail) =>
        notifyAdminNewRegistro({
          adminEmail,
          nombre:      user.nombre,
          email:       user.email,
          institucion: data.institucion,
          motivo:      data.motivo,
        })
      );
    });

    res.status(201).json({
      message: 'Revisa tu correo electrónico para verificar tu cuenta.',
      user: { id: user.id, nombre: user.nombre, email: user.email },
    });
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
      notifyRegistroRecibido({ email: result.email, nombre: result.nombre });

      // 2. Notificar a todos los admins con botón de activación directa
      getAdminEmails().then((adminEmails) => {
        adminEmails.forEach((adminEmail) =>
          notifyAdminUsuarioVerificado({
            adminEmail,
            nombre:        result.nombre,
            email:         result.email,
            activationUrl,
          })
        );
      });
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
