import { tienePermisoModulo } from '../modules/admin/modulos.service.js';

const ROLES_PANEL = ['admin_sig', 'super_admin'];

/** `?admin=true` solo abre la vista de gestión a un admin con permiso `ver` sobre ese módulo. */
export async function esVistaAdmin(adminParam, user, modulo) {
  if (adminParam !== 'true' || !ROLES_PANEL.includes(user?.rol)) return false;
  return tienePermisoModulo(user, modulo, 'ver');
}
