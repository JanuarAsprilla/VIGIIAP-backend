import { query, getClient } from '../../config/database.js';

/** Columnas editables vía PATCH /:clave -- `clave` queda fuera a propósito:
 *  es la clave primaria y el join hacia el registro estático de componentes
 *  del frontend, cambiarla rompería esa referencia sin ningún beneficio
 *  (mismo criterio que el slug inmutable de mapas, ver mapas.service.js). */
const CAMPOS_EDITABLES = ['titulo', 'descripcion', 'tag', 'activa', 'visibilidad', 'orden'];

const COLUMNAS = 'clave, titulo, descripcion, tag, activa, visibilidad, orden, creado_en, actualizado_en';

/** Mismo criterio que mapas/documentos/geovisores/categorias (ver
 *  mapas.service.js#visibilidadPermitida): visitante/publico solo ven
 *  contenido 'publico'; cualquier otro rol autenticado (investigador,
 *  tecnico, institucional, admin_sig, super_admin) ve todo. */
function visibilidadPermitida(user) {
  if (!user || user.rol === 'visitante' || user.rol === 'publico') return ['publico'];
  return null;
}

/**
 * Catálogo de herramientas. `isAdminView` (admin_sig/super_admin autenticado
 * con ?admin=true, resuelto en el controller) ve también las inactivas y
 * cualquier visibilidad, sin filtrar por `user`. Fuera de esa vista, se
 * aplican ambos filtros: activa=true y la visibilidad que el rol de `user`
 * tenga permitida. Las borradas lógicamente quedan siempre fuera para todos
 * -- igual criterio que categorias.service.js#getAll.
 */
export async function listar(isAdminView = false, user = null) {
  if (isAdminView) {
    const { rows } = await query(`SELECT ${COLUMNAS} FROM herramientas WHERE deleted_at IS NULL ORDER BY orden ASC, clave ASC`);
    return rows;
  }

  const permitida = visibilidadPermitida(user);
  const params = [];
  let visCond = '';
  if (permitida) {
    params.push(permitida);
    visCond = 'AND visibilidad = ANY($1)';
  }

  const { rows } = await query(
    `SELECT ${COLUMNAS} FROM herramientas
     WHERE deleted_at IS NULL AND activa = true ${visCond}
     ORDER BY orden ASC, clave ASC`,
    params,
  );
  return rows;
}

export async function crear({ clave, titulo, descripcion = null, tag, visibilidad = 'publico', orden }) {
  const ordenFinal = orden ?? await siguienteOrden();
  const { rows } = await query(
    `INSERT INTO herramientas (clave, titulo, descripcion, tag, visibilidad, orden)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING ${COLUMNAS}`,
    [clave, titulo, descripcion, tag, visibilidad, ordenFinal],
  );
  return rows[0];
}

async function siguienteOrden() {
  const { rows } = await query(
    "SELECT COALESCE(MAX(orden) + 1, 0) AS siguiente FROM herramientas WHERE deleted_at IS NULL",
  );
  return rows[0].siguiente;
}

/** Actualización parcial -- solo toca las columnas presentes en `cambios`. */
export async function actualizar(clave, cambios) {
  const entradas = Object.entries(cambios).filter(([campo]) => CAMPOS_EDITABLES.includes(campo));
  if (entradas.length === 0) {
    throw Object.assign(new Error('No hay campos válidos para actualizar'), { status: 400 });
  }

  const asignaciones = entradas.map(([campo], i) => `${campo} = $${i + 2}`).join(', ');
  const valores = entradas.map(([, valor]) => valor);

  const { rows } = await query(
    `UPDATE herramientas SET ${asignaciones}, actualizado_en = NOW()
     WHERE clave = $1 AND deleted_at IS NULL
     RETURNING ${COLUMNAS}`,
    [clave, ...valores],
  );
  if (!rows[0]) throw Object.assign(new Error('Herramienta no encontrada'), { status: 404 });
  return rows[0];
}

/** Reordena varias herramientas de una vez (drag & drop en el admin) -- una
 *  sola transacción para que un fallo a mitad de camino no deje órdenes
 *  inconsistentes entre sí. */
export async function reordenar(pares) {
  const client = await getClient();
  try {
    await client.query('BEGIN');
    for (const { clave, orden } of pares) {
      const { rowCount } = await client.query(
        'UPDATE herramientas SET orden = $2, actualizado_en = NOW() WHERE clave = $1 AND deleted_at IS NULL',
        [clave, orden],
      );
      if (rowCount === 0) {
        throw Object.assign(new Error(`Herramienta no encontrada: ${clave}`), { status: 404 });
      }
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

export async function eliminar(clave) {
  const { rowCount } = await query(
    'UPDATE herramientas SET deleted_at = NOW() WHERE clave = $1 AND deleted_at IS NULL',
    [clave],
  );
  if (rowCount === 0) throw Object.assign(new Error('Herramienta no encontrada'), { status: 404 });
}
