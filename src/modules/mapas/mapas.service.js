import { query } from '../../config/database.js';
import { paginate } from '../../utils/paginate.js';
import { slugify } from '../../utils/slugify.js';

function visibilidadPermitida(user) {
  if (!user || user.rol === 'visitante') return ['publico'];
  if (['admin_sig', 'investigador'].includes(user.rol)) return null;
  return ['publico', 'usuarios'];
}

export async function getAll(reqQuery, user) {
  const { limit, offset, meta } = paginate(reqQuery);
  const { categoria, q, admin } = reqQuery;

  const conditions = admin === 'true' ? [] : ['m.activo = true'];
  const params = [];

  if (admin !== 'true') {
    const permitida = visibilidadPermitida(user);
    if (permitida) {
      params.push(permitida);
      conditions.push(`m.visibilidad = ANY($${params.length})`);
    }
  }

  if (categoria) {
    params.push(categoria);
    conditions.push(`m.categoria = $${params.length}`);
  }
  if (q) {
    params.push(`%${q}%`);
    conditions.push(`(m.titulo ILIKE $${params.length} OR m.descripcion ILIKE $${params.length})`);
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  params.push(limit, offset);

  const [dataRes, countRes] = await Promise.all([
    query(
      `SELECT m.id, m.titulo, m.slug, m.categoria, m.anio, m.descripcion,
              m.thumbnail_url, m.archivo_pdf_url, m.archivo_img_url, m.geovisor_url,
              m.activo, m.visibilidad, m.creado_en
       FROM mapas m
       ${where}
       ORDER BY m.creado_en DESC
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    ),
    query(`SELECT COUNT(*) FROM mapas m ${where}`, params.slice(0, -2)),
  ]);

  return { data: dataRes.rows, meta: meta(Number(countRes.rows[0].count)) };
}

export async function getBySlug(slug, user) {
  const permitida = visibilidadPermitida(user);
  const visFilter = permitida ? 'AND m.visibilidad = ANY($2)' : '';
  const params = permitida ? [slug, permitida] : [slug];

  const { rows } = await query(
    `SELECT m.*, u.nombre AS autor
     FROM mapas m
     LEFT JOIN usuarios u ON u.id = m.creado_por
     WHERE m.slug = $1 AND m.activo = true ${visFilter}`,
    params
  );
  if (!rows[0]) throw Object.assign(new Error('Mapa no encontrado'), { status: 404 });
  return rows[0];
}

export async function create(data, userId) {
  const slug = slugify(data.titulo);
  const { rows } = await query(
    `INSERT INTO mapas (titulo, slug, categoria, anio, descripcion, thumbnail_url,
                        archivo_pdf_url, archivo_img_url, geovisor_url, visibilidad, creado_por)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
     RETURNING *`,
    [data.titulo, slug, data.categoria, data.anio, data.descripcion,
     data.thumbnail_url ?? null, data.archivo_pdf_url ?? null,
     data.archivo_img_url ?? null, data.geovisor_url ?? null,
     data.visibilidad ?? 'publico', userId]
  );
  return rows[0];
}

export async function update(id, data) {
  const COLS = ['titulo', 'categoria', 'anio', 'descripcion', 'thumbnail_url',
                'archivo_pdf_url', 'archivo_img_url', 'geovisor_url', 'visibilidad'];
  const updates = [];
  const params  = [];

  for (const col of COLS) {
    if (data[col] !== undefined) {
      params.push(data[col]);
      updates.push(`${col} = $${params.length}`);
    }
  }

  if (updates.length === 0) {
    throw Object.assign(new Error('Sin campos para actualizar'), { status: 400 });
  }

  updates.push('actualizado_en = NOW()');
  params.push(id);

  const { rows } = await query(
    `UPDATE mapas SET ${updates.join(', ')} WHERE id = $${params.length} RETURNING *`,
    params,
  );
  if (!rows[0]) throw Object.assign(new Error('Mapa no encontrado'), { status: 404 });
  return rows[0];
}

export async function setActivo(id, activo) {
  const { rows } = await query(
    'UPDATE mapas SET activo=$1, actualizado_en=NOW() WHERE id=$2 RETURNING *',
    [activo, id],
  );
  if (!rows[0]) throw Object.assign(new Error('Mapa no encontrado'), { status: 404 });
  return rows[0];
}

export async function remove(id) {
  await query('UPDATE mapas SET activo=false WHERE id=$1', [id]);
}
