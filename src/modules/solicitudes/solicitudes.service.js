import { query } from '../../config/database.js';
import { paginate } from '../../utils/paginate.js';

const ESTADOS = ['pendiente', 'en_revision', 'aprobada', 'rechazada', 'resuelta'];

// Transiciones válidas por estado actual
const TRANSITIONS = {
  pendiente:   ['en_revision', 'aprobada', 'rechazada'],
  en_revision: ['pendiente', 'aprobada', 'rechazada', 'resuelta'],
  aprobada:    ['resuelta', 'en_revision'],
  rechazada:   ['en_revision', 'aprobada'],
  resuelta:    [], // estado final
};

export async function getAll(reqQuery) {
  const { limit, offset, meta } = paginate(reqQuery);
  const { estado, tipo } = reqQuery;
  const params = [];
  const conditions = [];

  if (estado && ESTADOS.includes(estado)) {
    params.push(estado);
    conditions.push(`s.estado = $${params.length}`);
  }
  if (tipo) {
    params.push(tipo);
    conditions.push(`s.tipo = $${params.length}`);
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  params.push(limit, offset);

  const [data, count] = await Promise.all([
    query(
      `SELECT s.id, s.tipo, s.descripcion, s.estado, s.nota_admin,
              s.creado_en, s.actualizado_en, s.respondida_en,
              u.nombre AS solicitante, u.email,
              r.nombre AS revisado_por_nombre
       FROM solicitudes s
       JOIN usuarios u ON u.id = s.usuario_id
       LEFT JOIN usuarios r ON r.id = s.revisado_por
       ${where}
       ORDER BY
         CASE s.estado WHEN 'pendiente' THEN 0 WHEN 'en_revision' THEN 1 ELSE 2 END,
         s.creado_en ASC`,
      params.slice(0, -2)
    ),
    query(`SELECT COUNT(*) FROM solicitudes s ${where}`, params.slice(0, -2)),
  ]);

  // Añadir días pendiente a cada solicitud
  const enriched = data.rows.map((s) => ({
    ...s,
    dias_pendiente: Math.floor(
      (Date.now() - new Date(s.creado_en).getTime()) / 86_400_000
    ),
  }));

  return { data: enriched, meta: meta(Number(count.rows[0].count)) };
}

export async function getMine(userId, reqQuery) {
  const { limit, offset, meta } = paginate(reqQuery);
  const { rows: data } = await query(
    `SELECT id, tipo, descripcion, estado, nota_admin, respondida_en,
            creado_en, actualizado_en
     FROM solicitudes WHERE usuario_id=$1
     ORDER BY creado_en DESC LIMIT $2 OFFSET $3`,
    [userId, limit, offset]
  );
  const { rows: c } = await query(
    'SELECT COUNT(*) FROM solicitudes WHERE usuario_id=$1', [userId]
  );
  return { data, meta: meta(Number(c[0].count)) };
}

export async function getById(id, userId, isAdmin) {
  const params = [id];
  const ownerClause = isAdmin ? '' : 'AND s.usuario_id = $2';
  if (!isAdmin) params.push(userId);

  const { rows } = await query(
    `SELECT s.id, s.tipo, s.descripcion, s.estado, s.nota_admin,
            s.creado_en, s.actualizado_en, s.respondida_en,
            u.nombre AS solicitante, u.email,
            r.nombre AS revisado_por_nombre
     FROM solicitudes s
     JOIN usuarios u ON u.id = s.usuario_id
     LEFT JOIN usuarios r ON r.id = s.revisado_por
     WHERE s.id = $1 ${ownerClause}`,
    params
  );
  if (!rows[0]) throw Object.assign(new Error('Solicitud no encontrada'), { status: 404 });
  return rows[0];
}

export async function create(data, userId) {
  // Rate limit: máximo 5 solicitudes por usuario en las últimas 24 horas
  const { rows: recent } = await query(
    `SELECT COUNT(*) FROM solicitudes
     WHERE usuario_id = $1 AND creado_en > NOW() - INTERVAL '24 hours'`,
    [userId]
  );
  if (Number(recent[0].count) >= 5) {
    throw Object.assign(
      new Error('Límite alcanzado: máximo 5 solicitudes por día. Intenta mañana.'),
      { status: 429 }
    );
  }

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

  // Obtener estado actual para validar la transición
  const { rows: current } = await query(
    'SELECT estado FROM solicitudes WHERE id = $1', [id]
  );
  if (!current[0]) throw Object.assign(new Error('Solicitud no encontrada'), { status: 404 });

  const estadoActual = current[0].estado;
  const permitidos = TRANSITIONS[estadoActual] ?? [];
  if (!permitidos.includes(estado)) {
    throw Object.assign(
      new Error(
        `Transición inválida: "${estadoActual}" → "${estado}". ` +
        `Transiciones permitidas: ${permitidos.length ? permitidos.join(', ') : 'ninguna (estado final)'}`
      ),
      { status: 422 }
    );
  }

  const { rows } = await query(
    `UPDATE solicitudes SET estado=$1, nota_admin=$2, revisado_por=$3, actualizado_en=NOW()
     WHERE id=$4 RETURNING *`,
    [estado, nota ?? null, adminId, id]
  );
  return rows[0];
}

export async function responder(id, respuesta, adminId) {
  // Validar que no esté ya resuelta
  const { rows: current } = await query(
    'SELECT estado FROM solicitudes WHERE id = $1', [id]
  );
  if (!current[0]) throw Object.assign(new Error('Solicitud no encontrada'), { status: 404 });
  if (current[0].estado === 'resuelta') {
    throw Object.assign(
      new Error('Esta solicitud ya fue resuelta y no puede modificarse'),
      { status: 422 }
    );
  }

  const { rows } = await query(
    `UPDATE solicitudes
     SET estado='resuelta', nota_admin=$1, revisado_por=$2,
         respondida_en=NOW(), actualizado_en=NOW()
     WHERE id=$3 RETURNING *`,
    [respuesta, adminId, id]
  );
  return rows[0];
}
