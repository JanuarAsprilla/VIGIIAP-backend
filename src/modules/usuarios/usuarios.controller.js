import * as userService from './usuarios.service.js';

export async function index(req, res, next) {
  try { res.json(await userService.getAll(req.query)); } catch (err) { next(err); }
}

export async function updateRol(req, res, next) {
  try {
    const { rol, activo } = req.body;
    res.json(await userService.updateRol(req.params.id, rol, activo));
  } catch (err) { next(err); }
}

export async function changePassword(req, res, next) {
  try {
    const { currentPassword, newPassword } = req.body;
    await userService.updatePassword(req.user.id, currentPassword, newPassword);
    res.json({ message: 'Contraseña actualizada' });
  } catch (err) { next(err); }
}
