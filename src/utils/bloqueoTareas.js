import { getClient } from '../config/database.js';

const PREFIJO = 'vigiiap:tarea:';

/**
 * Ejecuta `tarea` solo si ninguna otra instancia la está ejecutando ahora. Usa un candado de
 * asesoría de PostgreSQL ligado a una transacción de una conexión dedicada: se libera solo al
 * terminar (confirmar o deshacer) y también si el proceso muere, así que no puede quedar tomado.
 * La tarea corre con sus propias conexiones del pool; esta solo sostiene el candado.
 *
 * Devuelve `{ ejecutada: false }` si otra instancia la tiene, y `{ ejecutada: true, resultado }`
 * si la ejecutó. Si la tarea falla, el error se propaga después de liberar el candado.
 */
export async function conBloqueo(nombre, tarea) {
  const cliente = await getClient();
  try {
    await cliente.query('BEGIN');
    const { rows } = await cliente.query(
      'SELECT pg_try_advisory_xact_lock(hashtextextended($1, 0)) AS obtenido',
      [`${PREFIJO}${nombre}`],
    );
    if (!rows[0].obtenido) {
      await cliente.query('ROLLBACK');
      return { ejecutada: false };
    }
    const resultado = await tarea();
    await cliente.query('COMMIT');
    return { ejecutada: true, resultado };
  } catch (err) {
    await cliente.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    cliente.release();
  }
}
