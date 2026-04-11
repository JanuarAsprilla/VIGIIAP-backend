import { query } from '../../config/database.js';
import { paginate } from '../../utils/paginate.js';

const ESTADOS = ['pendiente', 'en_revision', 'aprobada', 'rechazada'];

export async function getAll(reqQuery) {
  const { limit, offset, meta } = paginate(reqQuery);
  const { estado } = reqQuery;
  const params = [];
  const conditions = [];

  if (estado && ESTADOS.includes(estado)) {
    params.push(estado);
    conditions.push(`estado = $${params.length}`);
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  params.push(limit, offset);

  const [data, count] = await Promise.all([
    query(
      `SELECT s.id, s.tipo, s.descripcion, s.estado, s.creado_en,
              u.nombre AS solicitante, u.email
       FROM solicitudes s
       JOIN usuarios u ON u.id = s.usuario_id
       ${where}
       ORDER BY s.creado_en DESC
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    ),
    query(`SELECT COUNT(*) FROM solicitudes s ${where}`, params.slice(0, -2)),
  ]);

  return { data: data.rows, meta: meta(Number(count.rows[0].count)) };
}

export async function getMine(userId, reqQuery) {
  const { limit, offset, meta } = paginate(reqQuery);
  const { rows: data } = await query(
    `SELECT id, tipo, descripcion, estado, creado_en, actualizado_en
     FROM solicitudes WHERE usuario_id=$1
     ORDER BY creado_en DESC LIMIT $2 OFFSET $3`,
    [userId, limit, offset]
  );
  const { rows: c } = await query(
    'SELECT COUNT(*) FROM solicitudes WHERE usuario_id=$1', [userId]
  );
  return { data, meta: meta(Number(c[0].count)) };
}

export async function create(data, userId) {
  const { rows } = await query(
    `INSERT INTO solicitudes (tipo, descripcion, usuario_id)
     VALUES ($1,$2,$3) RETURNING *`,
    [data.tipo, data.descripcion, userId]
  );
  return rows[0];
}

export async function updateEstado(id, estado, nota, adminId) {
  if (!ESTADOS.includes(estado)) {
    throw Object.assign(new Error('Estado inválido'), { status: 400 });
  }
  const { rows } = await query(
    `UPDATE solicitudes SET estado=$1, nota_admin=$2, revisado_por=$3, actualizado_en=NOW()
     WHERE id=$4 RETURNING *`,
    [estado, nota ?? null, adminId, id]
  );
  if (!rows[0]) throw Object.assign(new Error('Solicitud no encontrada'), { status: 404 });
  return rows[0];
}
