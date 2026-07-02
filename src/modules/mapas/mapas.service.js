import { query } from '../../config/database.js';
import { paginate } from '../../utils/paginate.js';
import { slugify } from '../../utils/slugify.js';
import { deleteFileByUrl } from '../../config/r2.js';

/** Visibilidad según rol: visitante/publico solo ven contenido público.
 *  Usuarios verificados (investigador, tecnico, institucional, admin) acceso total.
 */
function visibilidadPermitida(user) {
  if (!user || user.rol === 'visitante' || user.rol === 'publico') return ['publico'];
  if (['admin_sig', 'super_admin', 'investigador', 'tecnico', 'institucional'].includes(user.rol)) return null;
  return ['publico', 'usuarios'];
}

export async function getAll(reqQuery, user) {
  const { limit, offset, meta } = paginate(reqQuery);
  const { categoria, q, admin } = reqQuery;
  if (q && q.length > 200) throw Object.assign(new Error('Búsqueda demasiado larga (máx. 200 caracteres)'), { status: 400 });
  const isAdminView = admin === 'true' && ['admin_sig', 'super_admin'].includes(user?.rol);

  const conditions = isAdminView ? ['m.deleted_at IS NULL'] : ['m.activo = true', 'm.deleted_at IS NULL'];
  const params = [];

  if (!isAdminView) {
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
     WHERE m.slug = $1 AND m.activo = true AND m.deleted_at IS NULL ${visFilter}`,
    params
  );
  if (!rows[0]) throw Object.assign(new Error('Mapa no encontrado'), { status: 404 });
  return rows[0];
}

export async function create(data, userId) {
  const slug = slugify(data.titulo);
  const { rows } = await query(
    `INSERT INTO mapas (titulo, slug, categoria, anio, descripcion, thumbnail_url,
                        archivo_pdf_url, archivo_img_url, geovisor_url, visibilidad, creado_por,
                        epsg, escala, fuente, bbox_norte, bbox_sur, bbox_este, bbox_oeste)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
     RETURNING *`,
    [data.titulo, slug, data.categoria, data.anio, data.descripcion,
     data.thumbnail_url ?? null, data.archivo_pdf_url ?? null,
     data.archivo_img_url ?? null, data.geovisor_url ?? null,
     data.visibilidad ?? 'publico', userId,
     data.epsg ?? null, data.escala ?? null, data.fuente ?? null,
     data.bbox_norte ?? null, data.bbox_sur ?? null,
     data.bbox_este ?? null, data.bbox_oeste ?? null]
  );
  return rows[0];
}

export async function update(id, data) {
  const COLS = ['titulo', 'categoria', 'anio', 'descripcion', 'thumbnail_url',
                'archivo_pdf_url', 'archivo_img_url', 'geovisor_url', 'visibilidad',
                'epsg', 'escala', 'fuente', 'bbox_norte', 'bbox_sur', 'bbox_este', 'bbox_oeste'];
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
  const { rows: existing } = await query(
    'SELECT archivo_pdf_url, archivo_img_url, thumbnail_url FROM mapas WHERE id=$1 AND deleted_at IS NULL', [id]
  );
  if (!existing[0]) throw Object.assign(new Error('Mapa no encontrado'), { status: 404 });
  await query('UPDATE mapas SET deleted_at = NOW(), actualizado_en = NOW() WHERE id = $1', [id]);
  const urls = [existing[0].archivo_pdf_url, existing[0].archivo_img_url, existing[0].thumbnail_url].filter(Boolean);
  await Promise.allSettled(urls.map(url => deleteFileByUrl(url)));
}
