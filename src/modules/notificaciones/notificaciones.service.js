/**
 * VIGIIAP — Notificaciones
 * Reemplaza el panel que se sintetizaba en cada GET a partir de
 * usuarios/solicitudes (ver getNotificaciones() en admin.service.js, ahora
 * retirado) por una tabla real -- el estado de lectura es por cuenta, no por
 * navegador (antes vivía en localStorage), y cualquier usuario puede
 * recibir una notificación, no solo administradores.
 */
import { query } from '../../config/database.js';

const MAX_LISTADO = 30;

/** Notificación para UN destinatario puntual (ej. "tu solicitud fue aprobada"). */
export async function crearNotificacion({ destinatarioId, tipo, mensaje, link = null }) {
  const { rows } = await query(
    `SELECT en_pantalla FROM usuario_notificacion_prefs WHERE usuario_id = $1 AND tipo_clave = $2`,
    [destinatarioId, tipo],
  );
  // Sin fila = preferencia por defecto (recibir) -- ver 046_usuario_notificacion_prefs.sql.
  if (rows[0]?.en_pantalla === false) return;

  await query(
    `INSERT INTO notificaciones (destinatario_id, tipo, mensaje, link) VALUES ($1,$2,$3,$4)`,
    [destinatarioId, tipo, mensaje, link],
  );
}

/**
 * Notificación para TODOS los admins activos (admin_sig + super_admin) en
 * este momento -- una fila por cada uno (fan-out), no una fila compartida:
 * así cada quien marca la suya como leída sin afectar a los demás, y un
 * admin creado después de este evento simplemente no la recibe (no hay
 * forma razonable de "notificar hacia el pasado"). Se excluye a quien haya
 * silenciado explícitamente este tipo (usuario_notificacion_prefs).
 */
export async function notificarAdmins({ tipo, mensaje, link = null }) {
  const { rows: admins } = await query(
    `SELECT u.id FROM usuarios u
     LEFT JOIN usuario_notificacion_prefs p ON p.usuario_id = u.id AND p.tipo_clave = $1
     WHERE u.rol IN ('admin_sig', 'super_admin') AND u.activo = true
       AND COALESCE(p.en_pantalla, true) = true`,
    [tipo],
  );
  if (!admins.length) return;

  const valores = admins.map((_a, i) => `($${i * 4 + 1}, $${i * 4 + 2}, $${i * 4 + 3}, $${i * 4 + 4})`).join(', ');
  const params = admins.flatMap((a) => [a.id, tipo, mensaje, link]);
  await query(
    `INSERT INTO notificaciones (destinatario_id, tipo, mensaje, link) VALUES ${valores}`,
    params,
  );
}

/** Últimas notificaciones del usuario autenticado, más recientes primero. */
export async function listar(destinatarioId) {
  const { rows } = await query(
    `SELECT id, tipo, mensaje, link, leido_en, creado_en
     FROM notificaciones WHERE destinatario_id = $1
     ORDER BY creado_en DESC LIMIT $2`,
    [destinatarioId, MAX_LISTADO],
  );
  return rows;
}

/** Marca UNA notificación como leída -- solo si pertenece a quien la pide. */
export async function marcarLeida(id, destinatarioId) {
  const { rowCount } = await query(
    `UPDATE notificaciones SET leido_en = NOW()
     WHERE id = $1 AND destinatario_id = $2 AND leido_en IS NULL`,
    [id, destinatarioId],
  );
  return rowCount > 0;
}

/** Marca todas las notificaciones pendientes del usuario como leídas. */
export async function marcarTodasLeidas(destinatarioId) {
  const { rowCount } = await query(
    `UPDATE notificaciones SET leido_en = NOW()
     WHERE destinatario_id = $1 AND leido_en IS NULL`,
    [destinatarioId],
  );
  return rowCount;
}
