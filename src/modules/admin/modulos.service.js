/**
 * VIGIIAP — Permisos por módulo de administradores SIG.
 * super_admin nunca pasa por aquí: acceso total hardcodeado (ver tienePermisoModulo)
 * para que nadie pueda auto-restringir la única cuenta con control total.
 */
import { query } from '../../config/database.js';
import { registrarAuditoria } from '../../utils/auditLog.js';

/** Catálogo fijo de módulos delegables del panel — mismo set que las secciones
 *  "Gestión" y "Sistema" del sidebar admin, menos Papelera (exclusiva de
 *  super_admin sin excepción, ver papelera.controller.js). */
export const MODULOS = [
  { clave: 'usuarios',             nombre: 'Usuarios' },
  { clave: 'solicitudes',          nombre: 'Solicitudes' },
  { clave: 'documentos',           nombre: 'Documentos' },
  { clave: 'mapas',                nombre: 'Mapas' },
  { clave: 'geovisores',           nombre: 'Geovisores' },
  { clave: 'conexiones_geoserver', nombre: 'Conexiones GeoServer' },
  { clave: 'categorias',           nombre: 'Categorías' },
  { clave: 'herramientas',         nombre: 'Herramientas' },
  { clave: 'configuracion',        nombre: 'Configuración' },
  { clave: 'actividad',            nombre: 'Actividad' },
  { clave: 'errores',              nombre: 'Errores' },
  { clave: 'reportes',             nombre: 'Reportes' },
];
const CLAVES_VALIDAS = new Set(MODULOS.map((m) => m.clave));

/**
 * Resuelve si `user` puede actuar sobre el módulo `clave` con la acción dada.
 * - super_admin: acceso total, sin consultar la BD.
 * - Cualquier otro rol que no sea admin_sig (investigador, tecnico, etc.):
 *   el sistema de módulos no le aplica — su acceso se rige por las reglas
 *   propias de cada recurso (ownership, visibilidad), no por este panel.
 * - admin_sig: se consulta admin_permisos_modulo. Sin fila = deniega por defecto.
 * @param {{ id: string, rol: string } | null | undefined} user
 * @param {string} clave
 * @param {'ver'|'editar'} accion
 * @returns {Promise<boolean>}
 */
export async function tienePermisoModulo(user, clave, accion = 'ver') {
  if (!user) return false;
  if (user.rol === 'super_admin') return true;
  if (user.rol !== 'admin_sig') return true;

  const { rows } = await query(
    'SELECT puede_ver, puede_editar FROM admin_permisos_modulo WHERE usuario_id = $1 AND modulo = $2',
    [user.id, clave]
  );
  if (!rows[0]) return false;
  return accion === 'editar' ? rows[0].puede_editar : rows[0].puede_ver;
}

/** Permisos de un admin_sig por módulo, con el catálogo completo (false por
 *  defecto en los módulos sin fila asignada) — listo para pintar checkboxes. */
export async function permisosDeAdmin(usuarioId) {
  const { rows } = await query(
    'SELECT modulo, puede_ver, puede_editar FROM admin_permisos_modulo WHERE usuario_id = $1',
    [usuarioId]
  );
  const porClave = Object.fromEntries(rows.map((r) => [r.modulo, r]));

  return MODULOS.map(({ clave, nombre }) => ({
    modulo: clave,
    nombre,
    puede_ver: porClave[clave]?.puede_ver ?? false,
    puede_editar: porClave[clave]?.puede_editar ?? false,
  }));
}

/** Reemplaza (upsert) los permisos de un admin_sig. Exclusivo de super_admin
 *  (ver requireSuperAdmin en admin.routes.js). */
export async function setPermisosAdmin(usuarioId, permisos, { superAdminId }) {
  const { rows: target } = await query('SELECT rol FROM usuarios WHERE id = $1', [usuarioId]);
  if (!target[0]) throw Object.assign(new Error('Usuario no encontrado'), { status: 404 });
  if (target[0].rol !== 'admin_sig') {
    throw Object.assign(new Error('Los permisos por módulo solo aplican a administradores SIG'), { status: 400 });
  }

  for (const permiso of permisos) {
    if (!CLAVES_VALIDAS.has(permiso.modulo)) {
      throw Object.assign(new Error(`Módulo inválido: ${permiso.modulo}`), { status: 400 });
    }
  }

  for (const { modulo, puede_ver, puede_editar } of permisos) {
    // puede_editar implica puede_ver — evita el estado inconsistente "edita
    // sin poder ver" que no tiene sentido de negocio.
    const editar = Boolean(puede_editar);
    const ver = Boolean(puede_ver) || editar;
    await query(
      `INSERT INTO admin_permisos_modulo (usuario_id, modulo, puede_ver, puede_editar)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (usuario_id, modulo) DO UPDATE
         SET puede_ver = EXCLUDED.puede_ver, puede_editar = EXCLUDED.puede_editar, actualizado_en = NOW()`,
      [usuarioId, modulo, ver, editar]
    );
  }

  registrarAuditoria({
    accion: 'update_permisos_modulo',
    modulo: 'admin',
    entidadId: usuarioId,
    descripcion: `Super admin actualizó permisos por módulo (${permisos.length} módulos)`,
    usuarioId: superAdminId,
  });

  return permisosDeAdmin(usuarioId);
}
