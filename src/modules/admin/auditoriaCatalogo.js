/**
 * Gravedad de cada acción del registro de auditoría. No se guarda en la tabla: se deduce
 * de la acción, así cambiar la clasificación no requiere migrar datos.
 */

export const SEVERIDADES = ['critica', 'advertencia', 'info'];

/**
 * Quien no es super_admin no ve la actividad de cuentas super_admin. Los eventos sin usuario
 * (accesos anónimos, intentos contra correos inexistentes) SÍ son visibles: con un simple
 * `usuario_id NOT IN (...)` se descartaban, porque NULL NOT IN (...) no es verdadero.
 */
export const EXCLUIR_SUPER_ADMIN =
  `(usuario_id IS NULL OR usuario_id NOT IN (SELECT id FROM usuarios WHERE rol = 'super_admin'))`;

const CRITICAS = [
  'refresh_token_reuse', 'login_blocked', 'alerta_rafaga_login',
  'delete_usuario', 'update_rol', 'update_permisos_modulo', 'create_admin', 'update_configuracion',
  'create_conexion_geoserver', 'update_conexion_geoserver', 'delete_conexion_geoserver',
];

const ADVERTENCIAS = [
  'login_failed', 'acceso_denegado', 'login_ubicacion_nueva', 'change_password', 'password_reset',
  'sesion_revocada', 'todas_sesiones_revocadas', 'update_usuario', 'rate_limit_auto_scale',
];

// Toda eliminación y toda exportación de datos merece atención, aunque la acción sea nueva.
const PREFIJOS_ADVERTENCIA = ['delete_', 'export_'];

export function severidadDeAccion(accion) {
  if (CRITICAS.includes(accion)) return 'critica';
  if (ADVERTENCIAS.includes(accion)) return 'advertencia';
  if (PREFIJOS_ADVERTENCIA.some((p) => accion?.startsWith(p))) return 'advertencia';
  return 'info';
}

/**
 * Condición SQL equivalente a severidadDeAccion() para filtrar en la consulta.
 * Agrega sus valores a `params` y devuelve el fragmento con los placeholders ya numerados.
 */
export function condicionSeveridad(severidad, params) {
  params.push(CRITICAS);
  const esCritica = `accion = ANY($${params.length}::text[])`;
  if (severidad === 'critica') return esCritica;

  // Solo se agrega el segundo parámetro cuando se usa: un $N declarado y sin usar hace
  // que Postgres no pueda inferir su tipo ("could not determine data type of parameter").
  params.push(ADVERTENCIAS);
  const prefijos = PREFIJOS_ADVERTENCIA.map((p) => `accion LIKE '${p.replace('_', '\\_')}%'`).join(' OR ');
  const esAdvertencia = `(accion = ANY($${params.length}::text[]) OR ${prefijos})`;

  if (severidad === 'advertencia') return `(NOT ${esCritica} AND ${esAdvertencia})`;
  return `(NOT ${esCritica} AND NOT ${esAdvertencia})`;
}

/** Acciones críticas, para contar eventos críticos en el resumen. */
export const ACCIONES_CRITICAS = CRITICAS;
