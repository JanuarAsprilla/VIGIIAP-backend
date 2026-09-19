import { tienePermisoModulo } from '../modules/admin/modulos.service.js';

/**
 * Exige que req.user tenga el módulo `clave` habilitado con la acción dada.
 * Usar después de authenticate + authorize('admin_sig', ...) en la ruta.
 * @param {string} clave - una clave de MODULOS (admin/modulos.service.js)
 * @param {'ver'|'editar'} accion
 */
export function requireModulo(clave, accion = 'ver') {
  return async (req, res, next) => {
    try {
      const permitido = await tienePermisoModulo(req.user, clave, accion);
      if (!permitido) {
        return res.status(403).json({ error: `No tienes acceso al módulo de ${clave}` });
      }
      next();
    } catch (err) {
      next(err);
    }
  };
}
