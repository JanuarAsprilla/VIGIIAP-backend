/**
 * VIGIIAP — Admin Service
 * Gestión de usuarios desde el panel de administración.
 * Toda acción aquí queda en Supabase (PostgreSQL) y se notifica por email.
 */
import bcrypt from 'bcryptjs';
import { query } from '../../config/database.js';
import { paginate } from '../../utils/paginate.js';
import { notifyUsuarioCreado, notifyUsuarioActivacion, notifyAdminNewRegistro } from '../../utils/mailer.js';
import { registrarAuditoria } from '../../utils/auditLog.js';

const ROLES = ['admin_sig', 'investigador', 'publico'];

/** Lista todos los usuarios con filtros */
export async function listarUsuarios(reqQuery) {
  const { limit, offset, meta } = paginate(reqQuery);
  const { rol, activo, q } = reqQuery;
  const conditions = [];
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
    params.push(`%${q}%`);
    conditions.push(`(nombre ILIKE $${params.length} OR email ILIKE $${params.length})`);
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  params.push(limit, offset);

  const [data, count] = await Promise.all([
    query(
      `SELECT id, nombre, email, rol, institucion, tipo_acceso, activo, creado_en, actualizado_en
       FROM usuarios ${where}
       ORDER BY creado_en DESC
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    ),
    query(`SELECT COUNT(*) FROM usuarios ${where}`, params.slice(0, -2)),
  ]);

  return { data: data.rows, meta: meta(Number(count.rows[0].count)) };
}

/** Crea un usuario desde el panel de admin */
export async function crearUsuario({ nombre, email, rol, institucion, tipoAcceso, adminId, adminEmail }) {
  if (!ROLES.includes(rol)) {
    throw Object.assign(new Error('Rol inválido'), { status: 400 });
  }

  const exists = await query('SELECT id FROM usuarios WHERE email = $1', [email.toLowerCase()]);
  if (exists.rows.length) {
    throw Object.assign(new Error('El email ya está registrado'), { status: 409 });
  }

  // Contraseña temporal aleatoria
  const passwordTemporal = Math.random().toString(36).slice(-8) + Math.random().toString(36).slice(-4).toUpperCase();
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
export async function actualizarUsuario({ id, rol, activo, adminId, adminEmail }) {
  if (rol && !ROLES.includes(rol)) {
    throw Object.assign(new Error('Rol inválido'), { status: 400 });
  }

  // Construir SET dinámico solo con los campos proporcionados
  const updates = [];
  const params = [];

  if (rol !== undefined) { params.push(rol); updates.push(`rol = $${params.length}`); }
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
export async function eliminarUsuario({ id, adminId, adminEmail }) {
  // No permitir que el admin se elimine a sí mismo
  if (id === adminId) {
    throw Object.assign(new Error('No puedes eliminar tu propia cuenta'), { status: 400 });
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

/** Obtiene los admins para enviar notificaciones */
export async function getAdminEmails() {
  const { rows } = await query(
    "SELECT email FROM usuarios WHERE rol = 'admin_sig' AND activo = true"
  );
  return rows.map((r) => r.email);
}

/** Consulta el audit log con paginación */
export async function getAuditLog(reqQuery) {
  const { limit, offset, meta } = paginate(reqQuery);
  const { modulo, accion } = reqQuery;
  const conditions = [];
  const params = [];

  if (modulo) { params.push(modulo); conditions.push(`modulo = $${params.length}`); }
  if (accion) { params.push(accion); conditions.push(`accion = $${params.length}`); }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
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
