/**
 * VIGIIAP — Catálogo de tipos de notificación (Fase 2 del plan de módulos).
 * Fuente única de verdad para ícono/color/etiqueta/audiencia -- antes vivía
 * hardcodeado en el frontend (TYPE_META, NotificacionesPanel.tsx) y ya no
 * coincidía con los valores reales que emite notificarAdmins()/
 * crearNotificacion() (ver migración 045).
 */
import { query } from '../../config/database.js';

/** @param {{ soloActivos?: boolean }} [opts] */
export async function listar({ soloActivos = true } = {}) {
  const where = soloActivos ? 'WHERE activo = true' : '';
  const { rows } = await query(
    `SELECT clave, nombre, icono, color, aplica_a, activo, orden
     FROM tipos_notificacion ${where} ORDER BY orden, clave`,
  );
  return rows;
}

export async function crear({ clave, nombre, icono, color, aplicaA, orden = 0 }) {
  const { rows } = await query(
    `INSERT INTO tipos_notificacion (clave, nombre, icono, color, aplica_a, orden)
     VALUES ($1,$2,$3,$4,$5,$6) RETURNING clave, nombre, icono, color, aplica_a, activo, orden`,
    [clave, nombre, icono, color, aplicaA, orden],
  );
  return rows[0];
}

export async function actualizar(clave, cambios) {
  const campos = [];
  const valores = [];
  let i = 1;

  if (cambios.nombre   !== undefined) { campos.push(`nombre = $${i++}`);    valores.push(cambios.nombre); }
  if (cambios.icono    !== undefined) { campos.push(`icono = $${i++}`);     valores.push(cambios.icono); }
  if (cambios.color    !== undefined) { campos.push(`color = $${i++}`);     valores.push(cambios.color); }
  if (cambios.aplicaA  !== undefined) { campos.push(`aplica_a = $${i++}`);  valores.push(cambios.aplicaA); }
  if (cambios.activo   !== undefined) { campos.push(`activo = $${i++}`);    valores.push(cambios.activo); }
  if (cambios.orden    !== undefined) { campos.push(`orden = $${i++}`);     valores.push(cambios.orden); }

  if (!campos.length) throw Object.assign(new Error('No hay cambios para aplicar'), { status: 400 });

  valores.push(clave);
  const { rows } = await query(
    `UPDATE tipos_notificacion SET ${campos.join(', ')} WHERE clave = $${i}
     RETURNING clave, nombre, icono, color, aplica_a, activo, orden`,
    valores,
  );
  if (!rows[0]) throw Object.assign(new Error('Tipo de notificación no encontrado'), { status: 404 });
  return rows[0];
}

/** Soft delete -- mismo patrón que categorías/mapas/documentos/geovisores: `activo=false`, nunca DELETE real. */
export async function desactivar(clave) {
  const { rowCount } = await query(
    `UPDATE tipos_notificacion SET activo = false WHERE clave = $1`,
    [clave],
  );
  if (!rowCount) throw Object.assign(new Error('Tipo de notificación no encontrado'), { status: 404 });
}
