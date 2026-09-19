import { query, getClient } from '../../config/database.js';
import { deleteFile, extractKey } from '../../config/r2.js';
import logger from '../../utils/logger.js';

/** Mismo criterio que documentos/mapas/geovisores.service.js -- visitante/publico solo ven contenido público. */
function visibilidadPermitida(user) {
  if (!user || user.rol === 'visitante' || user.rol === 'publico') return ['publico'];
  if (['admin_sig', 'super_admin', 'investigador', 'tecnico', 'institucional'].includes(user.rol)) return null;
  return ['publico', 'usuarios'];
}

/**
 * Devuelve todas las categorías con su thumbnail_url y el conteo real de
 * documentos/mapas/geovisores que la usan -- calculado en una sola consulta
 * (3 LEFT JOIN + COUNT DISTINCT), no traído a JS desde listados separados con
 * límite de página (eso subcontaba en cuanto un módulo pasaba de esa página).
 * documentos no tiene columna `categoria` propia -- `tipo` cumple ese rol
 * (ver documentos.service.js, que ya expone `tipo AS categoria`).
 *
 * Este endpoint es público y con cache compartido (ver categorias.routes.js),
 * así que el conteo SOLO cuenta lo que un visitante anónimo ya podría ver
 * navegando /documentos, /mapas, /geovisores -- sin esto, la cantidad de
 * borradores/contenido restringido por categoría quedaría expuesta a
 * cualquiera. admin=true de un admin_sig/super_admin autenticado sí ve el
 * conteo completo (activo o no, cualquier visibilidad) para la gestión real.
 */
export async function getAll(reqQuery = {}, user = null) {
  const isAdminView = reqQuery.admin === 'true' && ['admin_sig', 'super_admin'].includes(user?.rol);
  const permitida = isAdminView ? null : visibilidadPermitida(user);

  const params = [];
  let visParam = '';
  if (permitida) {
    params.push(permitida);
    visParam = `$${params.length}`;
  }

  const gate = (alias) => {
    let cond = `${alias}.deleted_at IS NULL`;
    if (!isAdminView) cond += ` AND ${alias}.activo = true`;
    if (visParam) cond += ` AND ${alias}.visibilidad = ANY(${visParam})`;
    return cond;
  };

  const { rows } = await query(
    `SELECT c.nombre, c.thumbnail_url, c.actualizado_en,
            COUNT(DISTINCT d.id) AS docs_count,
            COUNT(DISTINCT m.id) AS mapas_count,
            COUNT(DISTINCT g.id) AS geovisores_count
     FROM categorias c
     LEFT JOIN documentos d ON d.tipo = c.nombre AND ${gate('d')}
     LEFT JOIN mapas m ON m.categoria = c.nombre AND ${gate('m')}
     LEFT JOIN geovisores g ON g.categoria = c.nombre AND ${gate('g')}
     WHERE c.deleted_at IS NULL
     GROUP BY c.nombre, c.thumbnail_url, c.actualizado_en
     ORDER BY c.nombre`,
    params,
  );
  return rows.map((r) => ({
    nombre: r.nombre,
    thumbnail_url: r.thumbnail_url,
    actualizado_en: r.actualizado_en,
    conteo: {
      docs: Number(r.docs_count),
      mapas: Number(r.mapas_count),
      geovisores: Number(r.geovisores_count),
    },
  }));
}

/** Crea la categoría si no existe, actualiza thumbnail_url si se provee. */
export async function upsert(nombre, thumbnailUrl = null) {
  const { rows } = await query(
    `INSERT INTO categorias (nombre, thumbnail_url, actualizado_en)
     VALUES ($1, $2, NOW())
     ON CONFLICT (nombre) DO UPDATE
       SET thumbnail_url  = COALESCE($2, categorias.thumbnail_url),
           actualizado_en = NOW()
     RETURNING *`,
    [nombre, thumbnailUrl],
  );
  return rows[0];
}

/** Elimina el thumbnail actual (R2) y lo reemplaza con la nueva URL. */
export async function updateThumbnail(nombre, newUrl) {
  // Obtener URL anterior para borrar de R2
  const { rows: prev } = await query(
    'SELECT thumbnail_url FROM categorias WHERE nombre = $1',
    [nombre],
  );
  const oldUrl = prev[0]?.thumbnail_url;

  const result = await upsert(nombre, newUrl);

  if (oldUrl && oldUrl !== newUrl) {
    const key = extractKey(oldUrl);
    if (key) await deleteFile(key).catch((err) => logger.warn('[r2] delete failed', { key, error: err.message }));
  }

  return result;
}

/** Renombra una categoría y propaga el nuevo nombre a mapas, documentos y
 *  geovisores en una sola transacción. geovisores.categoria tiene FK con
 *  ON UPDATE CASCADE (se actualiza sola); mapas.categoria y documentos.tipo
 *  son TEXT libres sin FK, así que se actualizan a mano aquí. */
export async function rename(nombreActual, nombreNuevo) {
  const client = await getClient();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      'UPDATE categorias SET nombre = $2, actualizado_en = NOW() WHERE nombre = $1 AND deleted_at IS NULL RETURNING *',
      [nombreActual, nombreNuevo],
    );
    if (!rows[0]) throw Object.assign(new Error('Categoría no encontrada'), { status: 404 });

    await client.query('UPDATE mapas SET categoria = $2 WHERE categoria = $1', [nombreActual, nombreNuevo]);
    await client.query('UPDATE documentos SET tipo = $2 WHERE tipo = $1', [nombreActual, nombreNuevo]);

    await client.query('COMMIT');
    return rows[0];
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    if (err.code === '23505') {
      throw Object.assign(new Error('Ya existe una categoría con ese nombre'), { status: 409 });
    }
    throw err;
  } finally {
    client.release();
  }
}

/** Elimina una categoría (soft delete) y su thumbnail de R2 si existe. */
export async function remove(nombre) {
  const { rows: existing } = await query(
    'SELECT thumbnail_url FROM categorias WHERE nombre = $1 AND deleted_at IS NULL',
    [nombre],
  );
  if (!existing[0]) throw Object.assign(new Error('Categoría no encontrada'), { status: 404 });

  await query(
    'UPDATE categorias SET deleted_at = NOW() WHERE nombre = $1',
    [nombre]
  );

  const key = extractKey(existing[0].thumbnail_url);
  if (key) await deleteFile(key).catch((err) => logger.warn('[r2] delete failed', { key, error: err.message }));
}

