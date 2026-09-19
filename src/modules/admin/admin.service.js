/**
 * VIGIIAP — Admin Service
 * Gestión de usuarios desde el panel de administración.
 * Toda acción aquí queda en Supabase (PostgreSQL) y se notifica por email.
 */
import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';
import { query } from '../../config/database.js';
import { revokeAllRefreshTokens } from '../auth/auth.service.js';
import { paginate } from '../../utils/paginate.js';
import { notifyUsuarioCreado, notifyUsuarioActivacion, notifyAdminNewRegistro, notifyRolCambiado, clearMailConfigCache, notifyCambioConfigCritica } from '../../utils/mailer.js';
import { SUPER_ADMIN_ONLY_KEYS, CONFIG_LABELS } from './configSchema.js';
import { registrarAuditoria } from '../../utils/auditLog.js';
import { setMaintenanceState } from '../../middlewares/maintenanceMode.js';
import { clearDynamicConfigCache, getAdminEmailFallback } from '../../config/dynamicConfig.js';

/**
 * Genera una contraseña temporal criptográficamente segura.
 * Usa crypto.randomBytes para garantizar aleatoriedad real.
 */
function generateTempPassword(length = 12) {
  const chars = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789!@#$%';
  const randomBytes = crypto.randomBytes(length);
  return Array.from(randomBytes, (byte) => chars[byte % chars.length]).join('');
}

// Roles asignables desde el flujo genérico de "Usuarios". admin_sig queda
// fuera a propósito: crear/gestionar administradores tiene su propio flujo
// dedicado (ver crearAdminSig, listarAdministradores, GestionAdmins.tsx) para
// que solo exista un camino claro por tipo de cuenta.
const ROLES = ['investigador', 'tecnico', 'institucional', 'publico'];
// Roles que promocionan/degradan una cuenta ya existente (actualizarUsuario) —
// aquí sí se permite admin_sig: promover un usuario verificado a administrador
// es una transición legítima, distinta de "crear una cuenta admin desde cero".
const ROLES_ACTUALIZABLES = [...ROLES, 'admin_sig'];

/** Lista usuarios finales (nunca administradores) con filtros.
 *  Para administradores usar listarAdministradores(). */
export async function listarUsuarios(reqQuery) {
  const { limit, offset, meta } = paginate(reqQuery);
  const { rol, activo, q } = reqQuery;
  if (q && q.length > 200) throw Object.assign(new Error('Búsqueda demasiado larga (máx. 200 caracteres)'), { status: 400 });
  // admin_sig y super_admin nunca aparecen en la lista de usuarios finales —
  // tienen su propia vista dedicada (Gestión de Administradores).
  const conditions = ["rol NOT IN ('super_admin', 'admin_sig')"];
  const params = [];

  if (rol && ROLES.includes(rol)) {
    params.push(rol);
    conditions.push(`rol = $${params.length}`);
  }
  if (activo !== undefined) {
    params.push(activo === 'true');
    conditions.push(`activo = $${params.length}`);
  }
  if (q) {
    const qEsc = q.replace(/[%_\\]/g, '\\$&');
    params.push(`%${qEsc}%`);
    conditions.push(`(nombre ILIKE $${params.length} OR email ILIKE $${params.length})`);
  }

  const where = `WHERE ${conditions.join(' AND ')}`;
  params.push(limit, offset);

  const [data, count] = await Promise.all([
    query(
      `SELECT id, nombre, email, rol, institucion, tipo_acceso, activo,
              email_verified, motivo_acceso, creado_en, actualizado_en,
              rol_solicitado AS "rolSolicitado"
       FROM usuarios ${where}
       ORDER BY creado_en DESC
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    ),
    query(`SELECT COUNT(*) FROM usuarios ${where}`, params.slice(0, -2)),
  ]);

  return { data: data.rows, meta: meta(Number(count.rows[0].count)) };
}

/** Crea un usuario desde el panel de admin. Nunca crea cuentas admin_sig —
 *  esas se crean exclusivamente vía crearAdminSig() (POST /admin/super/crear-admin). */
export async function crearUsuario({ nombre, email, rol, institucion, tipoAcceso, adminId, adminEmail }) {
  if (!ROLES.includes(rol)) {
    throw Object.assign(new Error('Rol inválido'), { status: 400 });
  }

  const exists = await query('SELECT id FROM usuarios WHERE email = $1', [email.toLowerCase()]);
  if (exists.rows.length) {
    throw Object.assign(new Error('El email ya está registrado'), { status: 409 });
  }

  // Contraseña temporal criptográficamente segura
  const passwordTemporal = generateTempPassword(12);
  const password_hash = await bcrypt.hash(passwordTemporal, 12);

  const { rows } = await query(
    `INSERT INTO usuarios (nombre, email, password_hash, rol, institucion, tipo_acceso, activo)
     VALUES ($1,$2,$3,$4,$5,$6, true)
     RETURNING id, nombre, email, rol, institucion, tipo_acceso, activo, creado_en`,
    [nombre, email.toLowerCase(), password_hash, rol, institucion ?? null, tipoAcceso ?? 'institucional']
  );

  const usuario = rows[0];

  // Notificar al usuario creado (no bloqueante)
  notifyUsuarioCreado({ email: usuario.email, nombre: usuario.nombre, passwordTemporal, rol: usuario.rol });

  // Auditoría
  registrarAuditoria({
    accion: 'create_usuario',
    modulo: 'admin',
    entidadId: usuario.id,
    descripcion: `Admin creó usuario ${usuario.email} con rol ${rol}`,
    usuarioId: adminId,
    usuarioEmail: adminEmail,
  });

  return { ...usuario, _passwordTemporal: passwordTemporal };
}

/** Activa o desactiva un usuario, opcionalmente cambia su rol */
export async function actualizarUsuario({ id, rol, activo, adminId, adminRol, adminEmail }) {
  if (rol && !ROLES_ACTUALIZABLES.includes(rol)) {
    throw Object.assign(new Error('Rol inválido'), { status: 400 });
  }
  // Nadie puede modificar su propia cuenta desde el panel de administración
  if (id === adminId) {
    throw Object.assign(new Error('No puedes modificar tu propia cuenta desde este panel'), { status: 400 });
  }
  const { rows: target } = await query('SELECT rol FROM usuarios WHERE id = $1', [id]);
  if (!target[0]) throw Object.assign(new Error('Usuario no encontrado'), { status: 404 });
  // El super_admin es invisible e intocable para admin_sig
  if (target[0].rol === 'super_admin') {
    throw Object.assign(new Error('No se puede modificar una cuenta de Super Administrador'), { status: 403 });
  }
  // Solo el super_admin puede modificar cuentas admin_sig
  if (target[0].rol === 'admin_sig' && adminRol !== 'super_admin') {
    throw Object.assign(new Error('Solo el Super Administrador puede modificar cuentas de administrador'), { status: 403 });
  }
  // Solo el super_admin puede asignar el rol admin_sig
  if (rol === 'admin_sig' && adminRol !== 'super_admin') {
    throw Object.assign(new Error('Solo el Super Administrador puede asignar el rol de administrador'), { status: 403 });
  }

  // Construir SET dinámico solo con los campos proporcionados
  const updates = [];
  const params = [];

  // Cambiar el rol resuelve cualquier solicitud pendiente (rol_solicitado) —
  // sea que el admin la haya aprobado tal cual o asignado un rol distinto,
  // ya no debe seguir apareciendo como "pendiente" en el panel.
  if (rol !== undefined) {
    params.push(rol); updates.push(`rol = $${params.length}`);
    updates.push('rol_solicitado = NULL');
  }
  if (activo !== undefined) { params.push(activo); updates.push(`activo = $${params.length}`); }
  updates.push('actualizado_en = NOW()');

  params.push(id);

  const { rows } = await query(
    `UPDATE usuarios SET ${updates.join(', ')} WHERE id = $${params.length}
     RETURNING id, nombre, email, rol, activo, tipo_acceso`,
    params
  );
  if (!rows[0]) throw Object.assign(new Error('Usuario no encontrado'), { status: 404 });

  const usuario = rows[0];

  // Revocar sesiones activas si el rol cambia — el access token lleva el rol en el claim
  // y quedaría stale hasta su expiración (hasta 15min de ventana de privilegio incorrecto)
  if (rol !== undefined && rol !== target[0].rol) {
    await revokeAllRefreshTokens(id).catch(() => {});
    notifyRolCambiado({
      email: usuario.email, nombre: usuario.nombre,
      rolAnterior: target[0].rol, rolNuevo: rol,
    }).catch(() => {});
  }

  // Notificar al usuario afectado si cambia activo
  if (activo !== undefined) {
    notifyUsuarioActivacion({
      email: usuario.email,
      nombre: usuario.nombre,
      activo: usuario.activo,
      rol: usuario.rol,
    });
  }

  // Auditoría
  registrarAuditoria({
    accion: 'update_usuario',
    modulo: 'admin',
    entidadId: id,
    descripcion: `Admin actualizó usuario ${usuario.email} — activo:${activo} rol:${rol}`,
    usuarioId: adminId,
    usuarioEmail: adminEmail,
  });

  return usuario;
}

/** Elimina un usuario del sistema */
export async function eliminarUsuario({ id, adminId, adminRol, adminEmail }) {
  if (id === adminId) {
    throw Object.assign(new Error('No puedes eliminar tu propia cuenta'), { status: 400 });
  }
  const { rows: target } = await query('SELECT rol FROM usuarios WHERE id = $1', [id]);
  if (!target[0]) throw Object.assign(new Error('Usuario no encontrado'), { status: 404 });
  // El super_admin es invisible e intocable para admin_sig
  if (target[0].rol === 'super_admin') {
    throw Object.assign(new Error('No se puede eliminar una cuenta de Super Administrador'), { status: 403 });
  }
  // Solo el super_admin puede eliminar cuentas admin_sig
  if (target[0].rol === 'admin_sig' && adminRol !== 'super_admin') {
    throw Object.assign(new Error('Solo el Super Administrador puede eliminar cuentas de administrador'), { status: 403 });
  }

  const { rows } = await query(
    'DELETE FROM usuarios WHERE id = $1 RETURNING id, nombre, email',
    [id]
  );
  if (!rows[0]) throw Object.assign(new Error('Usuario no encontrado'), { status: 404 });

  registrarAuditoria({
    accion: 'delete_usuario',
    modulo: 'admin',
    entidadId: id,
    descripcion: `Admin eliminó usuario ${rows[0].email}`,
    usuarioId: adminId,
    usuarioEmail: adminEmail,
  });

  return rows[0];
}

/** Lee la configuración del sistema completa */
export async function getConfiguracion() {
  const { rows } = await query('SELECT clave, valor FROM configuracion ORDER BY clave');
  return Object.fromEntries(rows.map((r) => [r.clave, r.valor]));
}

/** Guarda (upsert) un mapa clave→valor en configuracion */
export async function setConfiguracion(config, adminId, adminEmail) {
  for (const [clave, valor] of Object.entries(config)) {
    await query(
      `INSERT INTO configuracion (clave, valor, actualizado_en)
       VALUES ($1, $2, NOW())
       ON CONFLICT (clave) DO UPDATE SET valor = EXCLUDED.valor, actualizado_en = NOW()`,
      [clave, String(valor)]
    );
  }

  // El middleware lee el estado de memoria, no BD — hay que empujar el
  // cambio ahí mismo para que el efecto sea inmediato.
  if ('modoMantenimiento' in config || 'mensajeMantenimiento' in config) {
    setMaintenanceState({
      modoMantenimiento:    config.modoMantenimiento,
      mensajeMantenimiento: config.mensajeMantenimiento,
    });
  }

  // mailer.js cachea la config SMTP 5 min — sin esto, "guardado" en la UI no
  // significaría "ya está en efecto" hasta que el cache expirara solo.
  const MAIL_KEYS = ['mail_host', 'mail_port', 'mail_secure', 'mail_user', 'mail_pass', 'mail_remitente', 'mail_remitente_nombre'];
  if (MAIL_KEYS.some((k) => k in config)) {
    clearMailConfigCache();
  }

  // Mismo motivo — dynamicConfig.js cachea CORS extra / rate limit / correo
  // de respaldo 5 min.
  const DYNAMIC_KEYS = ['cors_extra_origins', 'rate_limit_max', 'admin_email_fallback'];
  if (DYNAMIC_KEYS.some((k) => k in config)) {
    clearDynamicConfigCache();
  }

  registrarAuditoria({
    accion:      'update_configuracion',
    modulo:      'admin',
    descripcion: `Configuración del sistema actualizada (${Object.keys(config).length} campos)`,
    usuarioId:   adminId,
    usuarioEmail: adminEmail,
  });

  // Un ajuste solo-super_admin (SMTP, mantenimiento, política de privacidad)
  // que cambia sin que nadie más se entere es exactamente el escenario que
  // esto cierra: cada super_admin activo recibe el detalle de qué cambió y
  // quién lo hizo, además de quedar en la bitácora de arriba. Un correo por
  // destinatario (no uno solo con varios "to") — mismo patrón que las demás
  // alertas a admins (ver alertarAdmins en errorTracking.js).
  const criticalKeys = Object.keys(config).filter((k) => SUPER_ADMIN_ONLY_KEYS.has(k));
  if (criticalKeys.length) {
    const superAdminEmails = await getSuperAdminEmails();
    const cambios = criticalKeys.map((k) => CONFIG_LABELS[k] || k);
    await Promise.all(
      superAdminEmails.map((email) => notifyCambioConfigCritica({ email, cambios, adminEmail })),
    );
  }
}

/** Emails de los super_admin activos — para la alerta de cambio crítico de configuración. */
export async function getSuperAdminEmails() {
  const { rows } = await query(
    "SELECT email FROM usuarios WHERE rol = 'super_admin' AND activo = true"
  );
  return rows.map((r) => r.email);
}

/** Obtiene los admins para enviar notificaciones */
export async function getAdminEmails() {
  const { rows } = await query(
    "SELECT email FROM usuarios WHERE rol IN ('admin_sig', 'super_admin') AND activo = true"
  );
  const dbEmails = rows.map((r) => r.email);
  // Fallback: cubre el caso donde el email del admin en BD no es un dominio
  // válido o aún no hay admins en BD. admin_email_fallback (panel) tiene
  // prioridad sobre ADMIN_EMAIL (env var) si el super_admin lo configuró.
  const fallback = (await getAdminEmailFallback()) || process.env.ADMIN_EMAIL || '';
  const envEmails = fallback.split(',').map((e) => e.trim()).filter(Boolean);
  return [...new Set([...dbEmails, ...envEmails])];
}

/** Consulta el audit log con paginación */
export async function getAuditLog(reqQuery) {
  const { limit, offset, meta } = paginate(reqQuery);
  const { modulo, accion } = reqQuery;
  // Excluir acciones del super_admin — su email nunca debe aparecer en el log para admin_sig
  const conditions = [
    `usuario_id NOT IN (SELECT id FROM usuarios WHERE rol = 'super_admin')`
  ];
  const params = [];

  if (modulo) { params.push(modulo); conditions.push(`modulo = $${params.length}`); }
  if (accion) { params.push(accion); conditions.push(`accion = $${params.length}`); }

  const where = `WHERE ${conditions.join(' AND ')}`;
  params.push(limit, offset);

  const [data, count] = await Promise.all([
    query(
      `SELECT id, accion, modulo, entidad_id, descripcion, usuario_email, ip, creado_en
       FROM audit_log ${where}
       ORDER BY creado_en DESC
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    ),
    query(`SELECT COUNT(*) FROM audit_log ${where}`, params.slice(0, -2)),
  ]);

  return { data: data.rows, meta: meta(Number(count.rows[0].count)) };
}

/** Estadísticas extendidas para el panel super_admin */
export async function getSuperStats() {
  const { rows } = await query(`
    SELECT
      COUNT(*)                                                   AS total_usuarios,
      COUNT(*) FILTER (WHERE rol = 'admin_sig')                 AS admins,
      COUNT(*) FILTER (WHERE rol = 'investigador')              AS investigadores,
      COUNT(*) FILTER (WHERE rol = 'tecnico')                   AS tecnicos,
      COUNT(*) FILTER (WHERE rol IN ('institucional','publico')) AS otros,
      COUNT(*) FILTER (WHERE activo = true)                     AS activos,
      COUNT(*) FILTER (WHERE activo = false)                    AS inactivos,
      COUNT(*) FILTER (WHERE email_verified = false)            AS pendientes_verificacion
    FROM usuarios
    WHERE rol != 'super_admin'
  `);
  return rows[0];
}

/** Lista administradores SIG (rol=admin_sig) con sus permisos por módulo —
 *  vista dedicada del super_admin, separada por completo de listarUsuarios(). */
export async function listarAdministradores(reqQuery) {
  const { limit, offset, meta } = paginate(reqQuery);
  const { activo, q } = reqQuery;
  const conditions = ["rol = 'admin_sig'"];
  const params = [];

  if (activo !== undefined) {
    params.push(activo === 'true');
    conditions.push(`activo = $${params.length}`);
  }
  if (q) {
    if (q.length > 200) throw Object.assign(new Error('Búsqueda demasiado larga (máx. 200 caracteres)'), { status: 400 });
    const qEsc = q.replace(/[%_\\]/g, '\\$&');
    params.push(`%${qEsc}%`);
    conditions.push(`(nombre ILIKE $${params.length} OR email ILIKE $${params.length})`);
  }

  const where = `WHERE ${conditions.join(' AND ')}`;
  params.push(limit, offset);

  const [data, count] = await Promise.all([
    query(
      `SELECT u.id, u.nombre, u.email, u.institucion, u.activo, u.email_verified, u.creado_en,
              COALESCE(
                (SELECT json_agg(json_build_object('modulo', p.modulo, 'puede_ver', p.puede_ver, 'puede_editar', p.puede_editar))
                 FROM admin_permisos_modulo p WHERE p.usuario_id = u.id),
                '[]'
              ) AS permisos
       FROM usuarios u ${where}
       ORDER BY u.creado_en DESC
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    ),
    query(`SELECT COUNT(*) FROM usuarios ${where}`, params.slice(0, -2)),
  ]);

  return { data: data.rows, meta: meta(Number(count.rows[0].count)) };
}

/** Crea un nuevo admin_sig — solo puede llamar super_admin */
export async function crearAdminSig({ nombre, email, institucion, superAdminId }) {
  const { rows: existing } = await query('SELECT id FROM usuarios WHERE email = $1', [email.toLowerCase()]);
  if (existing.length) throw Object.assign(new Error('Ya existe un usuario con ese correo'), { status: 409 });

  // Contraseña temporal criptográficamente segura
  const tempPassword = generateTempPassword(12);

  const hash = await bcrypt.hash(tempPassword, 12);
  const { rows } = await query(
    `INSERT INTO usuarios (nombre, email, password_hash, rol, institucion, activo, email_verified)
     VALUES ($1, $2, $3, 'admin_sig', $4, true, true)
     RETURNING id, nombre, email, rol`,
    [nombre, email.toLowerCase(), hash, institucion ?? '']
  );

  registrarAuditoria({
    accion: 'create_admin',
    modulo: 'admin',
    entidadId: rows[0].id,
    descripcion: `Super admin creó administrador — ${rows[0].email}`,
    usuarioId: superAdminId,
  });

  await notifyUsuarioCreado({
    email: rows[0].email,
    nombre: rows[0].nombre,
    passwordTemporal: tempPassword,
    rol: 'admin_sig',
  }).catch(() => {});

  return rows[0];
}

// ── Reportes de actividad bajo demanda ──────────────────────────────────────

// toISOString() es UTC — en Colombia (UTC-5) corre la fecha un día cerca de medianoche.
function fmtLocalDate(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function calcularRango({ periodo, desde, hasta }) {
  const ahora = new Date();
  if (periodo === 'dia') {
    return { desde: new Date(ahora.getFullYear(), ahora.getMonth(), ahora.getDate()), hasta: ahora };
  }
  if (periodo === 'semana') {
    const d = new Date(ahora);
    d.setDate(ahora.getDate() - 7);
    return { desde: d, hasta: ahora };
  }
  if (periodo === 'mes') {
    return { desde: new Date(ahora.getFullYear(), ahora.getMonth(), 1), hasta: ahora };
  }
  if (periodo === 'anio') {
    return { desde: new Date(ahora.getFullYear(), 0, 1), hasta: ahora };
  }
  if (periodo === 'custom') {
    if (!desde || !hasta) {
      throw Object.assign(new Error('Rango de fechas requerido para período personalizado'), { status: 400 });
    }
    // new Date('YYYY-MM-DD') es UTC, new Date(y,m,d) es local — no mezclar.
    const [dy, dm, dd] = desde.split('-').map(Number);
    const [hy, hm, hd] = hasta.split('-').map(Number);
    return {
      desde: new Date(dy, dm - 1, dd),
      hasta: new Date(hy, hm - 1, hd, 23, 59, 59),
    };
  }
  throw Object.assign(new Error('Período inválido'), { status: 400 });
}

/** Reporte de actividad bajo demanda — agrega sobre audit_log + solicitudes. */
export async function getReporte(reqQuery) {
  const { desde, hasta } = calcularRango(reqQuery);

  const [conteos, porModulo, pendientes] = await Promise.all([
    query(`
      SELECT
        COUNT(*) FILTER (WHERE accion = 'registro')                        AS usuarios_nuevos,
        COUNT(*) FILTER (WHERE accion = 'create_usuario')                  AS usuarios_creados_admin,
        COUNT(*) FILTER (WHERE accion = 'create_solicitud')                AS solicitudes_nuevas,
        COUNT(*) FILTER (WHERE accion = 'update_solicitud_estado')         AS solicitudes_resueltas,
        COUNT(*) FILTER (WHERE accion = 'create_documento')                AS documentos_creados,
        COUNT(*) FILTER (WHERE accion = 'publish_documento')               AS documentos_publicados,
        COUNT(*) FILTER (WHERE accion = 'create_mapa')                     AS mapas_creados,
        COUNT(*) FILTER (WHERE accion = 'publish_mapa')                    AS mapas_publicados,
        COUNT(*) FILTER (WHERE accion = 'login')                           AS logins_exitosos,
        COUNT(*) FILTER (WHERE accion IN ('login_failed', 'login_blocked')) AS logins_fallidos
      FROM audit_log
      WHERE creado_en BETWEEN $1 AND $2
    `, [desde, hasta]),
    query(
      `SELECT modulo, COUNT(*) AS total FROM audit_log WHERE creado_en BETWEEN $1 AND $2 GROUP BY modulo ORDER BY total DESC`,
      [desde, hasta]
    ),
    query(`SELECT COUNT(*) FROM solicitudes WHERE estado IN ('pendiente', 'en_revision')`),
  ]);

  const c = conteos.rows[0];
  return {
    periodo: reqQuery.periodo,
    desde: fmtLocalDate(desde),
    hasta: fmtLocalDate(hasta),
    usuarios:    { nuevos: Number(c.usuarios_nuevos), creadosPorAdmin: Number(c.usuarios_creados_admin) },
    solicitudes: { nuevas: Number(c.solicitudes_nuevas), resueltas: Number(c.solicitudes_resueltas), pendientes: Number(pendientes.rows[0].count) },
    documentos:  { creados: Number(c.documentos_creados), publicados: Number(c.documentos_publicados) },
    mapas:       { creados: Number(c.mapas_creados), publicados: Number(c.mapas_publicados) },
    logins:      { exitosos: Number(c.logins_exitosos), fallidos: Number(c.logins_fallidos) },
    actividadPorModulo: porModulo.rows.map((r) => ({ modulo: r.modulo, total: Number(r.total) })),
  };
}

/** Registro propio de errores 5xx (ver src/utils/errorTracking.js) */
export async function getErrorLog(reqQuery) {
  const { limit, offset, meta } = paginate(reqQuery);

  const [data, count] = await Promise.all([
    query(
      `SELECT id, mensaje, stack, metodo, ruta, status_code, ocurrencias, primera_vez, ultima_vez
       FROM error_log
       ORDER BY ultima_vez DESC
       LIMIT $1 OFFSET $2`,
      [limit, offset],
    ),
    query(`SELECT COUNT(*) FROM error_log`),
  ]);

  return { data: data.rows, meta: meta(Number(count.rows[0].count)) };
}

// ── Tendencias del dashboard ────────────────────────────────────────────────
// Deltas semana-vs-semana-anterior + serie de 7 días por KPI, derivadas de
// audit_log (mismo enfoque que getReporte, sin tabla ni agregación nueva).
const KPI_ACCION = {
  usuarios:    'registro',
  solicitudes: 'create_solicitud',
  documentos:  'publish_documento',
  mapas:       'publish_mapa',
};

export async function getDashboardTendencias() {
  const desde = new Date();
  desde.setDate(desde.getDate() - 14);
  desde.setHours(0, 0, 0, 0);

  const { rows } = await query(
    `SELECT accion, creado_en FROM audit_log WHERE creado_en >= $1 AND accion = ANY($2::text[])`,
    [desde, Object.values(KPI_ACCION)]
  );

  const hoy = new Date();
  // 14 días locales, del más viejo al más nuevo (índice 13 = hoy).
  const dias14 = Array.from({ length: 14 }, (_, i) => {
    const d = new Date(hoy);
    d.setDate(hoy.getDate() - (13 - i));
    return fmtLocalDate(d);
  });

  const tendencias = {};
  for (const [kpi, accion] of Object.entries(KPI_ACCION)) {
    const porDia = new Map(dias14.map((d) => [d, 0]));
    rows.filter((r) => r.accion === accion).forEach((r) => {
      const dia = fmtLocalDate(new Date(r.creado_en));
      if (porDia.has(dia)) porDia.set(dia, porDia.get(dia) + 1);
    });
    const serie = dias14.map((d) => porDia.get(d));
    const semanaActual   = serie.slice(7).reduce((a, b) => a + b, 0);
    const semanaAnterior = serie.slice(0, 7).reduce((a, b) => a + b, 0);
    // Sin datos en la semana anterior: 0% si tampoco hay esta semana, 100% si arrancó de cero.
    const deltaPct = semanaAnterior === 0
      ? (semanaActual > 0 ? 100 : 0)
      : Math.round(((semanaActual - semanaAnterior) / semanaAnterior) * 100);
    tendencias[kpi] = { serie7: serie.slice(7), semanaActual, semanaAnterior, deltaPct };
  }
  return tendencias;
}
