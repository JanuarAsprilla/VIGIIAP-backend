import { query } from '../../config/database.js';
import { paginate } from '../../utils/paginate.js';
import { slugify } from '../../utils/slugify.js';
import { deleteFile } from '../../config/r2.js';

/** Devuelve los valores de visibilidad accesibles según el rol del usuario. */
function visibilidadPermitida(user) {
  if (!user || user.rol === 'visitante') return ['publico'];
  if (['admin_sig', 'investigador'].includes(user.rol)) return null; // sin filtro
  return ['publico', 'usuarios'];
}

export async function getAll(reqQuery, user) {
  const { limit, offset, meta } = paginate(reqQuery);
  const { tipo, anio, q, admin } = reqQuery;
  const conditions = ['d.activo = true'];
  const params = [];

  // El panel admin ve todo sin filtro de visibilidad
  if (admin !== 'true') {
    const permitida = visibilidadPermitida(user);
    if (permitida) {
      params.push(permitida);
      conditions.push(`d.visibilidad = ANY($${params.length})`);
    }
  }

  if (tipo)  { params.push(tipo);         conditions.push(`d.tipo = $${params.length}`); }
  if (anio)  { params.push(anio);         conditions.push(`d.anio = $${params.length}`); }
  if (q) {
    params.push(`%${q}%`);
    conditions.push(`(d.titulo ILIKE $${params.length} OR d.autores ILIKE $${params.length})`);
  }

  const where = conditions.join(' AND ');
  params.push(limit, offset);

  const [data, count] = await Promise.all([
    query(
      `SELECT id, titulo, slug, tipo, anio, autores, resumen, archivo_url, tamano_bytes, visibilidad, creado_en
       FROM documentos d WHERE ${where}
       ORDER BY d.anio DESC, d.creado_en DESC
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params,
    ),
    query(`SELECT COUNT(*) FROM documentos d WHERE ${where}`, params.slice(0, -2)),
  ]);

  return { data: data.rows, meta: meta(Number(count.rows[0].count)) };
}

export async function getBySlug(slug, user) {
  const permitida = visibilidadPermitida(user);
  const visFilter = permitida
    ? `AND d.visibilidad = ANY($2)`
    : '';
  const params = permitida ? [slug, permitida] : [slug];

  const { rows } = await query(
    `SELECT d.*, u.nombre AS autor
     FROM documentos d
     LEFT JOIN usuarios u ON u.id = d.creado_por
     WHERE d.slug = $1 AND d.activo = true ${visFilter}`,
    params,
  );
  if (!rows[0]) throw Object.assign(new Error('Documento no encontrado'), { status: 404 });
  return rows[0];
}

export async function create(data, userId) {
  const slug = slugify(data.titulo);
  const { rows } = await query(
    `INSERT INTO documentos (titulo, slug, tipo, anio, autores, resumen, archivo_url, tamano_bytes, visibilidad, creado_por)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
    [data.titulo, slug, data.tipo, data.anio, data.autores, data.resumen,
     data.archivo_url, data.archivo_tamano_bytes ?? null,
     data.visibilidad ?? 'publico', userId],
  );
  return rows[0];
}

export async function update(id, data) {
  const COLS = ['titulo', 'tipo', 'anio', 'autores', 'resumen', 'archivo_url', 'tamano_bytes', 'visibilidad'];
  if (data.archivo_tamano_bytes !== undefined) data.tamano_bytes = data.archivo_tamano_bytes;
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

function extractKey(url) {
  if (!url) return null;
  const publicUrl = process.env.R2_PUBLIC_URL;
  if (publicUrl && url.startsWith(publicUrl)) return url.slice(publicUrl.length + 1);
  return url.split('/').slice(-1)[0];
}

export async function remove(id) {
  const { rows } = await query('SELECT archivo_url FROM documentos WHERE id=$1', [id]);
  if (!rows[0]) return;
  await query('DELETE FROM documentos WHERE id=$1', [id]);
  const key = extractKey(rows[0].archivo_url);
  if (key) await deleteFile(key).catch(() => {});
}
