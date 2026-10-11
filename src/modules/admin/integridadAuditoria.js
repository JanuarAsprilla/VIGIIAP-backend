import { query } from '../../config/database.js';

const MAX_PROBLEMAS = 20;

/**
 * Recorre la cadena de hashes del registro de auditoría y devuelve los eventos donde se rompe:
 *  - contenido_alterado: el hash guardado no corresponde al contenido actual del evento;
 *  - evento_faltante:    hay un salto en la numeración (se quitó un evento del medio);
 *  - cadena_rota:        el hash previo no coincide con el del evento anterior.
 * El primer evento conservado no tiene anterior que comparar (la purga por retención borra los
 * más antiguos), así que solo se comprueba su contenido.
 */
export async function verificarIntegridadAuditoria() {
  const { rows: problemas } = await query(
    `WITH cadena AS (
       SELECT a.id, a.secuencia, a.hash, a.hash_previo, a.creado_en,
              LAG(a.hash)      OVER (ORDER BY a.secuencia) AS hash_anterior,
              LAG(a.secuencia) OVER (ORDER BY a.secuencia) AS secuencia_anterior,
              audit_log_calcular_hash(a) AS hash_recalculado
       FROM audit_log a WHERE a.secuencia IS NOT NULL
     )
     SELECT id, secuencia, creado_en,
            CASE
              WHEN hash <> hash_recalculado THEN 'contenido_alterado'
              WHEN secuencia_anterior IS NOT NULL AND secuencia <> secuencia_anterior + 1 THEN 'evento_faltante'
              WHEN secuencia_anterior IS NOT NULL AND hash_previo IS DISTINCT FROM hash_anterior THEN 'cadena_rota'
            END AS problema
     FROM cadena
     WHERE hash <> hash_recalculado
        OR (secuencia_anterior IS NOT NULL AND (secuencia <> secuencia_anterior + 1 OR hash_previo IS DISTINCT FROM hash_anterior))
     ORDER BY secuencia
     LIMIT $1`,
    [MAX_PROBLEMAS],
  );
  const { rows: totales } = await query(
    `SELECT COUNT(*)::int AS verificados, MIN(creado_en) AS desde, MAX(creado_en) AS hasta
     FROM audit_log WHERE secuencia IS NOT NULL`,
  );
  return { integra: problemas.length === 0, ...totales[0], problemas };
}
