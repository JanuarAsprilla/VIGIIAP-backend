import { query } from '../../config/database.js';
import { paginate } from '../../utils/paginate.js';
import { slugify } from '../../utils/slugify.js';

export async function getAll(reqQuery) {
  const { limit, offset, meta } = paginate(reqQuery);
  const { categoria, q, admin } = reqQuery;

  // admin=true bypasses activo filter so the admin panel can see all records
  const conditions = admin === 'true' ? [] : ['m.activo = true'];
  const params = [];

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
              m.activo, m.creado_en
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

export async function getBySlug(slug) {
  const { rows } = await query(
    `SELECT m.*, u.nombre AS autor
     FROM mapas m
     LEFT JOIN usuarios u ON u.id = m.creado_por
     WHERE m.slug = $1 AND m.activo = true`,
    [slug]
  );
  if (!rows[0]) throw Object.assign(new Error('Mapa no encontrado'), { status: 404 });
  return rows[0];
}

export async function create(data, userId) {
  const slug = slugify(data.titulo);
  const { rows } = await query(
    `INSERT INTO mapas (titulo, slug, categoria, anio, descripcion, thumbnail_url,
                        archivo_pdf_url, archivo_img_url, geovisor_url, creado_por)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
     RETURNING *`,
    [data.titulo, slug, data.categoria, data.anio, data.descripcion,
     data.thumbnail_url ?? null, data.archivo_pdf_url ?? null,
     data.archivo_img_url ?? null, data.geovisor_url ?? null, userId]
  );
  return rows[0];
}

export async function update(id, data) {
  const { rows } = await query(
    `UPDATE mapas SET titulo=$1, categoria=$2, anio=$3, descripcion=$4,
            thumbnail_url=$5, archivo_pdf_url=$6, archivo_img_url=$7,
            geovisor_url=$8, actualizado_en=NOW()
     WHERE id=$9 RETURNING *`,
    [data.titulo, data.categoria, data.anio, data.descripcion,
     data.thumbnail_url, data.archivo_pdf_url, data.archivo_img_url,
     data.geovisor_url, id]
  );
  if (!rows[0]) throw Object.assign(new Error('Mapa no encontrado'), { status: 404 });
  return rows[0];
}

export async function remove(id) {
  await query('UPDATE mapas SET activo=false WHERE id=$1', [id]);
}
