import { loginSchema, registerSchema } from './auth.schema.js';
import * as authService from './auth.service.js';
import { notifyRegistroRecibido, notifyAdminNewRegistro } from '../../utils/mailer.js';
import { getAdminEmails } from '../admin/admin.service.js';

export async function login(req, res, next) {
  try {
    const data = loginSchema.parse(req.body);
    const ip        = req.ip || req.headers['x-forwarded-for'];
    const userAgent = req.headers['user-agent'];
    const result = await authService.login(data.email, data.password, ip, userAgent);
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
    const result = await authService.loginVisitante({ nombre, ip, userAgent });
    res.json(result);
  } catch (err) {
    next(err);
  }
}

export async function register(req, res, next) {
  try {
    const data = registerSchema.parse(req.body);
    const user = await authService.register(data);

    // Notificar al usuario que su solicitud fue recibida
    notifyRegistroRecibido({ email: user.email, nombre: user.nombre });

    // Notificar a todos los admins del nuevo registro
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
      message: 'Solicitud enviada. Un administrador revisará tu acceso.',
      user,
    });
  } catch (err) {
    next(err);
  }
}

export async function me(req, res, next) {
  try {
    // Visitantes no tienen perfil en la tabla usuarios
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
