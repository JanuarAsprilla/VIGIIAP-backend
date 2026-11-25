import { query, getClient } from '../../config/database.js';
import { TIPOS_INVENTARIO } from './inventarioDiferencias.js';

// Solo se conservan las últimas sincronizaciones de cada conexión: son un historial corto, no una bitácora.
export const MAX_SINCRONIZACIONES_GUARDADAS = 50;

/** Ejecuta `trabajo(cliente)` en una transacción propia; deshace todo si falla. */
export async function enTransaccion(trabajo) {
  const cliente = await getClient();
  try {
    await cliente.query('BEGIN');
    const resultado = await trabajo(cliente);
    await cliente.query('COMMIT');
    return resultado;
  } catch (err) {
    await cliente.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    cliente.release();
  }
}

/** Todas las filas guardadas de un tipo (incluidas las eliminadas, para detectar reapariciones). */
export async function leerFilas(ejecutor, tipo, conexionId) {
  const { tabla, clave, columnas } = TIPOS_INVENTARIO[tipo];
  const { rows } = await ejecutor.query(
    `SELECT ${clave}, ${columnas.map((c) => c.nombre).join(', ')}, eliminado_en FROM ${tabla} WHERE conexion_id = $1`,
    [conexionId],
  );
  return rows;
}

/** Guarda las diferencias de un tipo: inserta/actualiza lo nuevo y cambiado, toca lo igual y marca lo eliminado. */
export async function aplicarDiferencias(cliente, tipo, conexionId, diferencias, instante) {
  const { tabla, clave, columnas } = TIPOS_INVENTARIO[tipo];
  const aEscribir = [...diferencias.nuevos, ...diferencias.cambiados];

  if (aEscribir.length > 0) {
    const nombres = columnas.map((c) => c.nombre);
    await cliente.query(
      `INSERT INTO ${tabla} (conexion_id, ${clave}, ${nombres.join(', ')}, primera_vez_visto, ultima_vez_visto, eliminado_en)
       SELECT $1, r.${clave}, ${nombres.map((n) => `r.${n}`).join(', ')}, $3::timestamptz, $3::timestamptz, NULL
         FROM jsonb_to_recordset($2::jsonb) AS r(${clave} text, ${columnas.map((c) => `${c.nombre} ${c.tipo}`).join(', ')})
       ON CONFLICT (conexion_id, ${clave}) DO UPDATE SET
         ${nombres.map((n) => `${n} = EXCLUDED.${n}`).join(', ')},
         ultima_vez_visto = EXCLUDED.ultima_vez_visto, eliminado_en = NULL`,
      [conexionId, JSON.stringify(aEscribir), instante],
    );
  }
  if (diferencias.iguales.length > 0) {
    await cliente.query(
      `UPDATE ${tabla} SET ultima_vez_visto = $3::timestamptz WHERE conexion_id = $1 AND ${clave} = ANY($2::text[])`,
      [conexionId, diferencias.iguales, instante],
    );
  }
  if (diferencias.eliminados.length > 0) {
    await cliente.query(
      `UPDATE ${tabla} SET eliminado_en = $3::timestamptz WHERE conexion_id = $1 AND ${clave} = ANY($2::text[]) AND eliminado_en IS NULL`,
      [conexionId, diferencias.eliminados, instante],
    );
  }
}

export async function registrarSincronizacion({ conexionId, iniciadaEn, estado, fuente, origen, resumen, error }) {
  await query(
    `INSERT INTO geoserver_sincronizaciones (conexion_id, iniciada_en, estado, fuente, origen, resumen, error)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7)`,
    [conexionId, iniciadaEn, estado, fuente, origen, JSON.stringify(resumen ?? {}), error ?? null],
  );
  await query(
    `DELETE FROM geoserver_sincronizaciones
      WHERE conexion_id = $1
        AND id NOT IN (SELECT id FROM geoserver_sincronizaciones WHERE conexion_id = $1 ORDER BY terminada_en DESC LIMIT $2)`,
    [conexionId, MAX_SINCRONIZACIONES_GUARDADAS],
  );
}

const COLUMNAS_SINCRONIZACION = 'iniciada_en, terminada_en, estado, fuente, origen, resumen, error';

/** Última sincronización de la conexión, de cualquier estado; null si nunca se sincronizó. */
export async function ultimaSincronizacion(conexionId) {
  const { rows } = await query(
    `SELECT ${COLUMNAS_SINCRONIZACION} FROM geoserver_sincronizaciones WHERE conexion_id = $1 ORDER BY terminada_en DESC LIMIT 1`,
    [conexionId],
  );
  return rows[0] ?? null;
}

/** Última sincronización que dejó inventario utilizable (ok o parcial). */
export async function ultimaSincronizacionUtil(conexionId) {
  const { rows } = await query(
    `SELECT terminada_en, estado FROM geoserver_sincronizaciones
      WHERE conexion_id = $1 AND estado <> 'error' ORDER BY terminada_en DESC LIMIT 1`,
    [conexionId],
  );
  return rows[0] ?? null;
}

const vigentes = (incluirEliminados) => (incluirEliminados ? '' : 'AND eliminado_en IS NULL');

/** Filas del inventario tal como se guardan, para la vista de administración (sin credenciales: no se guardan). */
export async function leerInventario(conexionId, { incluirEliminados = false } = {}) {
  const filtro = vigentes(incluirEliminados);
  const leer = (tabla, orden) => query(`SELECT * FROM ${tabla} WHERE conexion_id = $1 ${filtro} ORDER BY ${orden}`, [conexionId]);
  const [espacios, capas, grupos, estilos] = await Promise.all([
    leer('geoserver_inventario_espacios', 'nombre'),
    leer('geoserver_inventario_capas', 'capa_id'),
    leer('geoserver_inventario_grupos', 'grupo_id'),
    leer('geoserver_inventario_estilos', 'estilo_id'),
  ]);
  return { espacios: espacios.rows, capas: capas.rows, grupos: grupos.rows, estilos: estilos.rows };
}
