import { query } from '../../config/database.js';

// El rol 'investigador' solo puede subir documentos si el admin habilitó
// configuracion.investigadorCanUpload='true'. Ausente/otro valor → seguro por defecto (bloqueado).
export async function verificarPermisoInvestigador(userRol) {
  if (userRol !== 'investigador') return;
  const { rows: cfg } = await query(
    "SELECT valor FROM configuracion WHERE clave = 'investigadorCanUpload'", []
  );
  if (cfg[0]?.valor !== 'true') {
    throw Object.assign(
      new Error('Los usuarios con rol Investigador no tienen habilitada la subida de documentos. Contacta a un administrador.'),
      { status: 403 }
    );
  }
}

/** Antes del multipart: el archivo se escribe en R2 al parsearlo, así que un 403 posterior dejaría un objeto huérfano. */
export async function exigirPermisoDeSubida(req, _res, next) {
  try {
    await verificarPermisoInvestigador(req.user?.rol);
    next();
  } catch (err) { next(err); }
}
