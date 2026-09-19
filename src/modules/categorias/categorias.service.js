import { query, getClient } from '../../config/database.js';
import { deleteFile, extractKey } from '../../config/r2.js';
import logger from '../../utils/logger.js';

/**
 * Devuelve todas las categorías con su thumbnail_url y el conteo real de
 * documentos/mapas/geovisores que la usan -- calculado en una sola consulta
 * (3 LEFT JOIN + COUNT DISTINCT), no traído a JS desde listados separados con
 * límite de página (eso subcontaba en cuanto un módulo pasaba de esa página).
 * documentos no tiene columna `categoria` propia -- `tipo` cumple ese rol
 * (ver documentos.service.js, que ya expone `tipo AS categoria`).
 */
export async function getAll() {
  const { rows } = await query(
    `SELECT c.nombre, c.thumbnail_url, c.actualizado_en,
            COUNT(DISTINCT d.id) AS docs_count,
            COUNT(DISTINCT m.id) AS mapas_count,
            COUNT(DISTINCT g.id) AS geovisores_count
     FROM categorias c
     LEFT JOIN documentos d ON d.tipo = c.nombre AND d.deleted_at IS NULL
     LEFT JOIN mapas m ON m.categoria = c.nombre AND m.deleted_at IS NULL
     LEFT JOIN geovisores g ON g.categoria = c.nombre AND g.deleted_at IS NULL
     WHERE c.deleted_at IS NULL
     GROUP BY c.nombre, c.thumbnail_url, c.actualizado_en
     ORDER BY c.nombre`,
    [],
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

