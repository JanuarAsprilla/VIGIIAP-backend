import { updateRolSchema, updatePasswordSchema, updatePerfilSchema } from './usuarios.schema.js';
import * as userService from './usuarios.service.js';
import { registrarAuditoria } from '../../utils/auditLog.js';
import { revokeToken } from '../../utils/tokenBlacklist.js';
import {
  COOKIE_NAME, clearCookieOptions,
  REFRESH_COOKIE_NAME, clearRefreshCookieOptions,
} from '../../utils/cookieOptions.js';

export async function getMe(req, res, next) {
  try { res.json(await userService.getProfile(req.user.id)); } catch (err) { next(err); }
}

export async function index(req, res, next) {
  try { res.json(await userService.getAll(req.query)); } catch (err) { next(err); }
}

export async function updateRol(req, res, next) {
  try {
    const { rol, activo } = updateRolSchema.parse(req.body);
    const usuario = await userService.updateRol(req.params.id, rol, activo, { id: req.user.id, rol: req.user.rol });
    registrarAuditoria({
      accion:      'update_rol',
      modulo:      'usuarios',
      entidadId:   req.params.id,
      descripcion: `Rol actualizado a "${rol}", activo=${activo}`,
      usuarioId:   req.user.id,
      usuarioEmail: req.user.email,
      ip:          req.ip,
    });
    res.json(usuario);
  } catch (err) { next(err); }
}

export async function updateMe(req, res, next) {
  try {
    const data    = updatePerfilSchema.parse(req.body);
    const usuario = await userService.updatePerfil(req.user.id, data);
    registrarAuditoria({
      accion:      'update_perfil',
      modulo:      'usuarios',
      entidadId:   req.user.id,
      descripcion: `Usuario actualizó su perfil`,
      usuarioId:   req.user.id,
      usuarioEmail: req.user.email,
      ip:          req.ip,
    });
    res.json(usuario);
  } catch (err) { next(err); }
}

export async function updateAvatar(req, res, next) {
  try {
    const avatarUrl = req.body.avatar_url;
    if (!avatarUrl) {
      return res.status(422).json({ error: 'Debes seleccionar una imagen para la foto de perfil' });
    }
    const usuario = await userService.updateAvatar(req.user.id, avatarUrl);
    registrarAuditoria({
      accion:      'update_avatar',
      modulo:      'usuarios',
      entidadId:   req.user.id,
      descripcion: `Usuario actualizó su foto de perfil`,
      usuarioId:   req.user.id,
      usuarioEmail: req.user.email,
      ip:          req.ip,
    });
    res.json(usuario);
  } catch (err) { next(err); }
}

export async function changePassword(req, res, next) {
  try {
    const { currentPassword, newPassword } = updatePasswordSchema.parse(req.body);
    await userService.updatePassword(req.user.id, currentPassword, newPassword);

    // Blacklistear el access token actual — ya no es válido tras el cambio
    const token = req.cookies?.[COOKIE_NAME] ?? req.headers.authorization?.slice(7);
    if (token && req.user?.exp) await revokeToken(token, req.user.exp);
    res.clearCookie(COOKIE_NAME, clearCookieOptions());
    res.clearCookie(REFRESH_COOKIE_NAME, clearRefreshCookieOptions());

    registrarAuditoria({
      accion:       'change_password',
      modulo:       'usuarios',
      entidadId:    req.user.id,
      descripcion:  'Usuario cambió su contraseña — sesiones revocadas',
      usuarioId:    req.user.id,
      usuarioEmail: req.user.email,
      ip:           req.ip,
    });
    res.json({ message: 'Contraseña actualizada. Por seguridad, inicia sesión nuevamente.' });
  } catch (err) { next(err); }
}
