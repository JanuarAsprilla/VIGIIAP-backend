import { updateRolSchema, updatePasswordSchema, updatePerfilSchema } from './usuarios.schema.js';
import * as userService from './usuarios.service.js';
import { registrarAuditoria } from '../../utils/auditLog.js';

export async function index(req, res, next) {
  try { res.json(await userService.getAll(req.query)); } catch (err) { next(err); }
}

export async function updateRol(req, res, next) {
  try {
    const { rol, activo } = updateRolSchema.parse(req.body);
    const usuario = await userService.updateRol(req.params.id, rol, activo);
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

export async function changePassword(req, res, next) {
  try {
    const { currentPassword, newPassword } = updatePasswordSchema.parse(req.body);
    await userService.updatePassword(req.user.id, currentPassword, newPassword);
    registrarAuditoria({
      accion:      'change_password',
      modulo:      'usuarios',
      entidadId:   req.user.id,
      descripcion: 'Usuario cambió su contraseña',
      usuarioId:   req.user.id,
      usuarioEmail: req.user.email,
      ip:          req.ip,
    });
    res.json({ message: 'Contraseña actualizada' });
  } catch (err) { next(err); }
}
