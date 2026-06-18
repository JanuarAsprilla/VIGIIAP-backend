import { query } from '../../config/database.js';
import { deleteFile } from '../../config/r2.js';

/** Devuelve todas las categorías con su thumbnail_url. */
export async function getAll() {
  const { rows } = await query(
    'SELECT nombre, thumbnail_url, actualizado_en FROM categorias WHERE deleted_at IS NULL ORDER BY nombre',
    [],
  );
  return rows;
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
    if (key) await deleteFile(key).catch(() => {});
  }

  return result;
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
  if (key) await deleteFile(key).catch(() => {});
}

function extractKey(url) {
  if (!url) return null;
  const publicUrl = process.env.R2_PUBLIC_URL;
  if (publicUrl && url.startsWith(publicUrl)) return url.slice(publicUrl.length + 1);
  return url.split('/').slice(-1)[0];
}
