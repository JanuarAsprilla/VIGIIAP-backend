import { query } from '../../config/database.js';
import { paginate } from '../../utils/paginate.js';
import { slugify } from '../../utils/slugify.js';
import logger from '../../utils/logger.js';
import { deleteFileByUrl } from '../../config/r2.js';

/**
 * Devuelve los valores de visibilidad accesibles según el rol del usuario:
 * visitante y publico solo ven contenido público, mientras que
 * investigador, tecnico, institucional, admin_sig y super_admin acceden
 * sin filtro.
 */
function visibilidadPermitida(user) {
  if (!user || user.rol === 'visitante' || user.rol === 'publico') return ['publico'];
  if (['admin_sig', 'super_admin', 'investigador', 'tecnico', 'institucional'].includes(user.rol)) return null;
  return ['publico', 'usuarios'];
}

export async function getAll(reqQuery, user) {
  const { limit, offset, meta } = paginate(reqQuery);
  const { tipo, anio, q, admin } = reqQuery;
  if (q && q.length > 200) throw Object.assign(new Error('Búsqueda demasiado larga (máx. 200 caracteres)'), { status: 400 });
  const isAdminView = admin === 'true' && ['admin_sig', 'super_admin'].includes(user?.rol);
  const conditions = isAdminView ? ['d.deleted_at IS NULL'] : ['d.activo = true', 'd.deleted_at IS NULL'];
  const params = [];

  // El panel admin ve todo sin filtro de visibilidad
  if (!isAdminView) {
    const permitida = visibilidadPermitida(user);
    if (permitida) {
      params.push(permitida);
      conditions.push(`d.visibilidad = ANY($${params.length})`);
    }
  }

  if (tipo)  { params.push(tipo);         conditions.push(`d.tipo = $${params.length}`); }
  if (anio)  { params.push(anio);         conditions.push(`d.anio = $${params.length}`); }
  if (q) {
    // Escapar metacaracteres LIKE (% y _) para evitar bypass de filtrado
    const qEsc = q.replace(/[%_\\]/g, '\\$&');
    params.push(`%${qEsc}%`);
    conditions.push(`(d.titulo ILIKE $${params.length} ESCAPE '\\' OR d.autores ILIKE $${params.length} ESCAPE '\\')`);
  }

  const where = conditions.join(' AND ');
  params.push(limit, offset);

  const [data, count] = await Promise.all([
    query(
      `SELECT d.id, d.titulo, d.slug, d.tipo, d.tipo AS categoria, d.anio, d.autores, d.resumen,
              d.archivo_url, d.tamano_bytes, d.visibilidad, d.creado_en,
              c.thumbnail_url AS categoria_thumbnail_url
       FROM documentos d
       LEFT JOIN categorias c ON c.nombre = d.tipo
       WHERE ${where}
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
    `SELECT d.id, d.titulo, d.slug, d.tipo, d.anio, d.autores, d.resumen,
            d.archivo_url, d.tamano_bytes, d.visibilidad, d.activo, d.creado_en, d.actualizado_en,
            u.nombre AS autor
     FROM documentos d
     LEFT JOIN usuarios u ON u.id = d.creado_por
     WHERE d.slug = $1 AND d.activo = true ${visFilter}`,
    params,
  );
  if (!rows[0]) throw Object.assign(new Error('Documento no encontrado'), { status: 404 });
  return rows[0];
}

// El rol 'investigador' solo puede subir documentos si el admin habilitó
// configuracion.investigadorCanUpload='true'. Ausente/otro valor → seguro por defecto (bloqueado).
async function verificarPermisoInvestigador(userRol) {
  if (userRol !== 'investigador') return;
  const { rows: cfg } = await query(
    "SELECT valor FROM configuracion WHERE clave = 'investigadorCanUpload'", []
  );
  if (cfg[0]?.valor !== 'true') {
    throw Object.assign(
      new Error('Los usuarios con rol Investigador no tienen habilitada la subida de documentos. Contacta a un administrador.'),
      { status: 403 }
    );
  }
}

export async function create(data, userId, userRol) {
  await verificarPermisoInvestigador(userRol);

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

export async function remove(id) {
  const { rows: existing } = await query(
    `UPDATE documentos SET deleted_at = NOW(), actualizado_en = NOW()
     WHERE id = $1 AND deleted_at IS NULL RETURNING archivo_url`, [id]
  );
  if (!existing[0]) throw Object.assign(new Error('Documento no encontrado'), { status: 404 });
  if (existing[0].archivo_url) await deleteFileByUrl(existing[0].archivo_url).catch((err) => logger.warn('[r2] delete failed', { error: err.message }));
}

export async function setActivo(id, activo) {
  const { rows } = await query(
    'UPDATE documentos SET activo=$1, actualizado_en=NOW() WHERE id=$2 RETURNING *',
    [activo, id],
  );
  if (!rows[0]) throw Object.assign(new Error('Documento no encontrado'), { status: 404 });
  return rows[0];
}
