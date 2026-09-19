/**
 * VIGIIAP — Preferencias de notificación por usuario (Fase 3 del plan de
 * módulos). Sin fila en usuario_notificacion_prefs = recibir (default) --
 * silenciar un tipo es la excepción explícita que se guarda, igual que
 * usuarios.tema (migración 044).
 */
import { query } from '../../config/database.js';

/** Preferencias del usuario para los tipos que le aplican (admin ve 'admin'+'ambos', el resto ve 'usuario'+'ambos'). */
export async function obtener(usuarioId, rol) {
  const audiencia = ['admin_sig', 'super_admin'].includes(rol) ? ['admin', 'ambos'] : ['usuario', 'ambos'];
  const { rows } = await query(
    `SELECT t.clave, t.nombre, t.icono, t.color, COALESCE(p.en_pantalla, true) AS en_pantalla
     FROM tipos_notificacion t
     LEFT JOIN usuario_notificacion_prefs p ON p.usuario_id = $1 AND p.tipo_clave = t.clave
     WHERE t.activo = true AND t.aplica_a = ANY($2::text[])
     ORDER BY t.orden, t.clave`,
    [usuarioId, audiencia],
  );
  return rows;
}

export async function actualizar(usuarioId, tipoClave, enPantalla) {
  const { rows: tipo } = await query('SELECT 1 FROM tipos_notificacion WHERE clave = $1 AND activo = true', [tipoClave]);
  if (!tipo[0]) throw Object.assign(new Error('Tipo de notificación no encontrado'), { status: 404 });

  await query(
    `INSERT INTO usuario_notificacion_prefs (usuario_id, tipo_clave, en_pantalla)
     VALUES ($1,$2,$3)
     ON CONFLICT (usuario_id, tipo_clave) DO UPDATE
       SET en_pantalla = EXCLUDED.en_pantalla, actualizado_en = NOW()`,
    [usuarioId, tipoClave, enPantalla],
  );
}
