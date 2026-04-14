import { query } from '../../config/database.js';
import { paginate } from '../../utils/paginate.js';
import { slugify } from '../../utils/slugify.js';

export async function getAll(reqQuery) {
  const { limit, offset, meta } = paginate(reqQuery);
  const { categoria, q, admin } = reqQuery;

  // admin=true bypasses publicado filter so the admin panel can see drafts too
  const conditions = admin === 'true' ? [] : ['n.publicado = true'];
  const params = [];

  if (categoria) { params.push(categoria); conditions.push(`n.categoria = $${params.length}`); }
  if (q) {
    params.push(`%${q}%`);
    conditions.push(`(n.titulo ILIKE $${params.length} OR n.resumen ILIKE $${params.length})`);
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  params.push(limit, offset);

  const [data, count] = await Promise.all([
    query(
      `SELECT id, titulo, slug, categoria, resumen, imagen_url, publicado, publicado_en, creado_en
       FROM noticias n ${where}
       ORDER BY COALESCE(n.publicado_en, n.creado_en) DESC
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    ),
    query(`SELECT COUNT(*) FROM noticias n ${where}`, params.slice(0, -2)),
  ]);

  return { data: data.rows, meta: meta(Number(count.rows[0].count)) };
}

export async function getBySlug(slug) {
  const { rows } = await query(
    `SELECT n.*, u.nombre AS autor
     FROM noticias n
     LEFT JOIN usuarios u ON u.id = n.creado_por
     WHERE n.slug = $1 AND n.publicado = true`,
    [slug]
  );
  if (!rows[0]) throw Object.assign(new Error('Noticia no encontrada'), { status: 404 });
  return rows[0];
}

export async function create(data, userId) {
  const slug = slugify(data.titulo);
  const { rows } = await query(
    `INSERT INTO noticias (titulo, slug, categoria, resumen, contenido, imagen_url,
                           publicado, creado_por, publicado_en)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8, CASE WHEN $7 THEN NOW() ELSE NULL END)
     RETURNING *`,
    [data.titulo, slug, data.categoria, data.resumen, data.contenido,
     data.imagen_url ?? null, data.publicado ?? false, userId]
  );
  return rows[0];
}

export async function update(id, data) {
  const { rows } = await query(
    `UPDATE noticias SET titulo=$1, categoria=$2, resumen=$3, contenido=$4,
            imagen_url=$5, publicado=$6,
            publicado_en = CASE WHEN $6 AND publicado_en IS NULL THEN NOW() ELSE publicado_en END,
            actualizado_en=NOW()
     WHERE id=$7 RETURNING *`,
    [data.titulo, data.categoria, data.resumen, data.contenido,
     data.imagen_url, data.publicado, id]
  );
  if (!rows[0]) throw Object.assign(new Error('Noticia no encontrada'), { status: 404 });
  return rows[0];
}

export async function remove(id) {
  await query('DELETE FROM noticias WHERE id=$1', [id]);
}
