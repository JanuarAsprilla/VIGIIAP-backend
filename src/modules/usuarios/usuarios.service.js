import bcrypt from 'bcryptjs';
import { query } from '../../config/database.js';
import { paginate } from '../../utils/paginate.js';
import { revokeAllRefreshTokens } from '../auth/auth.service.js';
import { notifyRolCambiado } from '../../utils/mailer.js';
import { deleteFileByUrl } from '../../config/r2.js';

// super_admin excluido: solo el propio super_admin puede asignarlo vía admin.service
const ROLES = ['admin_sig', 'investigador', 'tecnico', 'institucional', 'publico'];

export async function getProfile(userId) {
  const { rows } = await query(
    'SELECT id, nombre, email, rol, tipo_acceso, institucion, activo, avatar_url, creado_en, last_login_at FROM usuarios WHERE id=$1',
    [userId]
  );
  if (!rows[0]) throw Object.assign(new Error('Usuario no encontrado'), { status: 404 });
  return rows[0];
}

export async function getAll(reqQuery) {
  const { limit, offset, meta } = paginate(reqQuery);
  const { rol, activo } = reqQuery;
  // super_admin siempre excluido — invisible para admin_sig
  const conditions = ["rol != 'super_admin'"];
  const params = [];

  if (rol && ROLES.includes(rol)) { params.push(rol); conditions.push(`rol = $${params.length}`); }
  if (activo !== undefined) { params.push(activo === 'true'); conditions.push(`activo = $${params.length}`); }

  const where = `WHERE ${conditions.join(' AND ')}`;
  params.push(limit, offset);

  const [data, count] = await Promise.all([
    query(
      `SELECT id, nombre, email, rol, institucion, activo, creado_en, last_login_at
       FROM usuarios ${where}
       ORDER BY creado_en DESC
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    ),
    query(`SELECT COUNT(*) FROM usuarios ${where}`, params.slice(0, -2)),
  ]);

  return { data: data.rows, meta: meta(Number(count.rows[0].count)) };
}

export async function updateRol(id, rol, activo, caller = {}) {
  if (!ROLES.includes(rol)) throw Object.assign(new Error('Rol inválido'), { status: 400 });
  // Nadie puede modificar su propia cuenta desde este panel
  if (id === caller.id) {
    throw Object.assign(new Error('No puedes modificar tu propia cuenta desde este panel'), { status: 400 });
  }
  const { rows: target } = await query('SELECT rol FROM usuarios WHERE id = $1', [id]);
  if (!target[0]) throw Object.assign(new Error('Usuario no encontrado'), { status: 404 });
  // El super_admin es invisible e intocable para admin_sig
  if (target[0].rol === 'super_admin') {
    throw Object.assign(new Error('No se puede modificar una cuenta de Super Administrador'), { status: 403 });
  }
  // Solo el super_admin puede modificar cuentas admin_sig o asignar ese rol
  if ((target[0].rol === 'admin_sig' || rol === 'admin_sig') && caller.rol !== 'super_admin') {
    throw Object.assign(new Error('Solo el Super Administrador puede gestionar cuentas de administrador'), { status: 403 });
  }
  const { rows } = await query(
    'UPDATE usuarios SET rol=$1, activo=$2, actualizado_en=NOW() WHERE id=$3 RETURNING id,nombre,email,rol,activo',
    [rol, activo, id]
  );
  if (!rows[0]) throw Object.assign(new Error('Usuario no encontrado'), { status: 404 });

  const usuario = rows[0];

  // Revocar sesiones activas y notificar por email si el rol realmente cambió —
  // mismo comportamiento que admin.service.js#actualizarUsuario: el access token
  // lleva el rol en el claim y quedaría stale con privilegios incorrectos hasta
  // su expiración (hasta 15min) si no se revoca al degradar/escalar un rol.
  if (rol !== target[0].rol) {
    await revokeAllRefreshTokens(id).catch(() => {});
    notifyRolCambiado({
      email: usuario.email, nombre: usuario.nombre,
      rolAnterior: target[0].rol, rolNuevo: rol,
    }).catch(() => {});
  }

  return usuario;
}

export async function updatePerfil(userId, { nombre, institucion }) {
  const updates = [];
  const params  = [];

  if (nombre      !== undefined) { params.push(nombre);      updates.push(`nombre = $${params.length}`); }
  if (institucion !== undefined) { params.push(institucion); updates.push(`institucion = $${params.length}`); }
  updates.push('actualizado_en = NOW()');
  params.push(userId);

  const { rows } = await query(
    `UPDATE usuarios SET ${updates.join(', ')} WHERE id = $${params.length}
     RETURNING id, nombre, email, rol, institucion, activo`,
    params
  );
  if (!rows[0]) throw Object.assign(new Error('Usuario no encontrado'), { status: 404 });
  return rows[0];
}

export async function updateAvatar(userId, avatarUrl) {
  const { rows: current } = await query('SELECT avatar_url FROM usuarios WHERE id = $1', [userId]);
  if (!current[0]) throw Object.assign(new Error('Usuario no encontrado'), { status: 404 });
  const previousUrl = current[0].avatar_url;

  const { rows } = await query(
    `UPDATE usuarios SET avatar_url = $1, actualizado_en = NOW() WHERE id = $2
     RETURNING id, nombre, email, rol, institucion, activo, avatar_url`,
    [avatarUrl, userId]
  );
  if (!rows[0]) throw Object.assign(new Error('Usuario no encontrado'), { status: 404 });

  // Borra la foto anterior de R2 tras confirmar el UPDATE — evita huérfanos en el bucket
  if (previousUrl && previousUrl !== avatarUrl) {
    await deleteFileByUrl(previousUrl).catch(() => {});
  }

  return rows[0];
}

export async function updatePassword(userId, currentPassword, newPassword) {
  const { rows } = await query('SELECT password_hash FROM usuarios WHERE id=$1', [userId]);
  if (!rows[0]) throw Object.assign(new Error('Usuario no encontrado'), { status: 404 });

  const valid = await bcrypt.compare(currentPassword, rows[0].password_hash);
  if (!valid) throw Object.assign(new Error('Contraseña actual incorrecta'), { status: 401 });

  const hash = await bcrypt.hash(newPassword, 12);
  await query(
    'UPDATE usuarios SET password_hash=$1, password_changed_at=NOW(), actualizado_en=NOW() WHERE id=$2',
    [hash, userId]
  );
  await revokeAllRefreshTokens(userId);
}
