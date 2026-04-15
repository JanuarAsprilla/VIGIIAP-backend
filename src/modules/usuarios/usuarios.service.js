import bcrypt from 'bcryptjs';
import { query } from '../../config/database.js';
import { paginate } from '../../utils/paginate.js';

const ROLES = ['admin_sig', 'investigador', 'publico'];

export async function getAll(reqQuery) {
  const { limit, offset, meta } = paginate(reqQuery);
  const { rol, activo } = reqQuery;
  const conditions = [];
  const params = [];

  if (rol && ROLES.includes(rol)) { params.push(rol); conditions.push(`rol = $${params.length}`); }
  if (activo !== undefined) { params.push(activo === 'true'); conditions.push(`activo = $${params.length}`); }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  params.push(limit, offset);

  const [data, count] = await Promise.all([
    query(
      `SELECT id, nombre, email, rol, institucion, activo, creado_en
       FROM usuarios ${where}
       ORDER BY creado_en DESC
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    ),
    query(`SELECT COUNT(*) FROM usuarios ${where}`, params.slice(0, -2)),
  ]);

  return { data: data.rows, meta: meta(Number(count.rows[0].count)) };
}

export async function updateRol(id, rol, activo) {
  if (!ROLES.includes(rol)) throw Object.assign(new Error('Rol inválido'), { status: 400 });
  const { rows } = await query(
    'UPDATE usuarios SET rol=$1, activo=$2, actualizado_en=NOW() WHERE id=$3 RETURNING id,nombre,email,rol,activo',
    [rol, activo, id]
  );
  if (!rows[0]) throw Object.assign(new Error('Usuario no encontrado'), { status: 404 });
  return rows[0];
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

export async function updatePassword(userId, currentPassword, newPassword) {
  const { rows } = await query('SELECT password_hash FROM usuarios WHERE id=$1', [userId]);
  if (!rows[0]) throw Object.assign(new Error('Usuario no encontrado'), { status: 404 });

  const valid = await bcrypt.compare(currentPassword, rows[0].password_hash);
  if (!valid) throw Object.assign(new Error('Contraseña actual incorrecta'), { status: 401 });

  const hash = await bcrypt.hash(newPassword, 12);
  await query('UPDATE usuarios SET password_hash=$1, actualizado_en=NOW() WHERE id=$2', [hash, userId]);
}
