import { query } from '../../config/database.js';
import { paginate } from '../../utils/paginate.js';
import { slugify } from '../../utils/slugify.js';
import { deleteFile } from '../../config/r2.js';

function visibilidadPermitida(user) {
  if (!user || user.rol === 'visitante') return ['publico'];
  if (['admin_sig', 'investigador'].includes(user.rol)) return null;
  return ['publico', 'usuarios'];
}

export async function getAll(reqQuery, user) {
  const { limit, offset, meta } = paginate(reqQuery);
  const { categoria, q, admin } = reqQuery;

  const conditions = admin === 'true' ? [] : ['n.publicado = true'];
  const params = [];

  if (admin !== 'true') {
    const permitida = visibilidadPermitida(user);
    if (permitida) {
      params.push(permitida);
      conditions.push(`n.visibilidad = ANY($${params.length})`);
    }
  }

  if (categoria) { params.push(categoria); conditions.push(`n.categoria = $${params.length}`); }
  if (q) {
    params.push(`%${q}%`);
    conditions.push(`(n.titulo ILIKE $${params.length} OR n.resumen ILIKE $${params.length})`);
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  params.push(limit, offset);

  const [data, count] = await Promise.all([
    query(
      `SELECT id, titulo, slug, categoria, resumen, imagen_url, publicado, publicado_en, visibilidad, creado_en
       FROM noticias n ${where}
       ORDER BY COALESCE(n.publicado_en, n.creado_en) DESC
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params,
    ),
    query(`SELECT COUNT(*) FROM noticias n ${where}`, params.slice(0, -2)),
  ]);

  return { data: data.rows, meta: meta(Number(count.rows[0].count)) };
}

export async function getBySlug(slug, user) {
  const permitida = visibilidadPermitida(user);
  const visFilter = permitida ? 'AND n.visibilidad = ANY($2)' : '';
  const params = permitida ? [slug, permitida] : [slug];

  const { rows } = await query(
    `SELECT n.*, u.nombre AS autor
     FROM noticias n
     LEFT JOIN usuarios u ON u.id = n.creado_por
     WHERE n.slug = $1 AND n.publicado = true ${visFilter}`,
    params,
  );
  if (!rows[0]) throw Object.assign(new Error('Noticia no encontrada'), { status: 404 });
  return rows[0];
}

export async function create(data, userId) {
  const slug = slugify(data.titulo);
  const { rows } = await query(
    `INSERT INTO noticias (titulo, slug, categoria, resumen, contenido, imagen_url,
                           publicado, visibilidad, creado_por, publicado_en)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9, CASE WHEN $7 THEN NOW() ELSE NULL END)
     RETURNING *`,
    [data.titulo, slug, data.categoria, data.resumen, data.contenido,
     data.imagen_url ?? null, data.publicado ?? false,
     data.visibilidad ?? 'publico', userId],
  );
  return rows[0];
}

export async function update(id, data) {
  const COLS = ['titulo', 'categoria', 'resumen', 'contenido', 'imagen_url', 'visibilidad'];
  const updates = [];
  const params  = [];

  for (const col of COLS) {
    if (data[col] !== undefined) {
      params.push(data[col]);
      updates.push(`${col} = $${params.length}`);
    }
  }

  if (data.publicado !== undefined) {
    params.push(data.publicado);
    const idx = params.length;
    updates.push(`publicado = $${idx}`);
    updates.push(`publicado_en = CASE WHEN $${idx} AND publicado_en IS NULL THEN NOW() ELSE publicado_en END`);
  }

  if (updates.length === 0) {
    throw Object.assign(new Error('Sin campos para actualizar'), { status: 400 });
  }

  updates.push('actualizado_en = NOW()');
  params.push(id);

  const { rows } = await query(
    `UPDATE noticias SET ${updates.join(', ')} WHERE id = $${params.length} RETURNING *`,
    params,
  );
  if (!rows[0]) throw Object.assign(new Error('Noticia no encontrada'), { status: 404 });
  return rows[0];
}

function extractKey(url) {
  if (!url) return null;
  const publicUrl = process.env.R2_PUBLIC_URL;
  if (publicUrl && url.startsWith(publicUrl)) return url.slice(publicUrl.length + 1);
  return url.split('/').slice(-1)[0];
}

export async function remove(id) {
  const { rows } = await query('SELECT imagen_url FROM noticias WHERE id=$1', [id]);
  if (!rows[0]) return;
  await query('DELETE FROM noticias WHERE id=$1', [id]);
  const key = extractKey(rows[0].imagen_url);
  if (key) await deleteFile(key).catch(() => {});
}
