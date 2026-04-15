import { query } from '../../config/database.js';
import { paginate } from '../../utils/paginate.js';
import { slugify } from '../../utils/slugify.js';

export async function getAll(reqQuery) {
  const { limit, offset, meta } = paginate(reqQuery);
  const { tipo, anio, q } = reqQuery;
  const conditions = ['d.activo = true'];
  const params = [];

  if (tipo) { params.push(tipo); conditions.push(`d.tipo = $${params.length}`); }
  if (anio) { params.push(anio); conditions.push(`d.anio = $${params.length}`); }
  if (q) {
    params.push(`%${q}%`);
    conditions.push(`(d.titulo ILIKE $${params.length} OR d.autores ILIKE $${params.length})`);
  }

  const where = conditions.join(' AND ');
  params.push(limit, offset);

  const [data, count] = await Promise.all([
    query(
      `SELECT id, titulo, slug, tipo, anio, autores, resumen, archivo_url, creado_en
       FROM documentos d WHERE ${where}
       ORDER BY d.anio DESC, d.creado_en DESC
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    ),
    query(`SELECT COUNT(*) FROM documentos d WHERE ${where}`, params.slice(0, -2)),
  ]);

  return { data: data.rows, meta: meta(Number(count.rows[0].count)) };
}

export async function getBySlug(slug) {
  const { rows } = await query(
    'SELECT * FROM documentos WHERE slug=$1 AND activo=true', [slug]
  );
  if (!rows[0]) throw Object.assign(new Error('Documento no encontrado'), { status: 404 });
  return rows[0];
}

export async function create(data, userId) {
  const slug = slugify(data.titulo);
  const { rows } = await query(
    `INSERT INTO documentos (titulo, slug, tipo, anio, autores, resumen, archivo_url, creado_por)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
    [data.titulo, slug, data.tipo, data.anio, data.autores, data.resumen, data.archivo_url, userId]
  );
  return rows[0];
}

export async function update(id, data) {
  const COLS = ['titulo', 'tipo', 'anio', 'autores', 'resumen', 'archivo_url'];
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
    `UPDATE documentos SET ${updates.join(', ')} WHERE id = $${params.length} AND activo = true RETURNING *`,
    params,
  );
  if (!rows[0]) throw Object.assign(new Error('Documento no encontrado'), { status: 404 });
  return rows[0];
}

export async function remove(id) {
  await query('UPDATE documentos SET activo=false WHERE id=$1', [id]);
}
