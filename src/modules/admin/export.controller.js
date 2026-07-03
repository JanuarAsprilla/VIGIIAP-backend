/**
 * export.controller.js — Exportación de datos en CSV y JSON.
 * Sin dependencias externas para evitar vulnerabilidades de parsing (SheetJS CVEs).
 * CSV generado directamente: seguro porque los datos vienen de nuestra BD (no de input externo).
 */
import { query } from '../../config/database.js';
import { registrarAuditoria } from '../../utils/auditLog.js';

const MAX_ROWS = 10_000;

// Campos sensibles que NUNCA se exportan
const EXCLUDED = new Set([
  'password_hash', 'totp_secret', 'totp_backup_codes',
  'email_verification_token', 'password_reset_token',
]);

function sanitize(rows) {
  return rows.map((row) => {
    const clean = {};
    for (const [k, v] of Object.entries(row)) {
      if (!EXCLUDED.has(k)) clean[k] = v;
    }
    return clean;
  });
}

function toCSV(rows) {
  if (!rows.length) return '';
  const headers = Object.keys(rows[0]);
  const escape  = (v) => {
    if (v === null || v === undefined) return '';
    let s = String(v);
    // Prevenir CSV formula injection: prefijo ' neutraliza =,+,-,@,TAB,CR en Excel/Sheets
    if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
    return s.includes(',') || s.includes('"') || s.includes('\n') || s.startsWith("'")
      ? `"${s.replace(/"/g, '""')}"`
      : s;
  };
  const lines = rows.map((r) => headers.map((h) => escape(r[h])).join(','));
  return [headers.join(','), ...lines].join('\r\n');
}

function sendExport(res, rows, filename, formato) {
  const clean = sanitize(rows);
  if (formato === 'json') {
    res.setHeader('Content-Disposition', `attachment; filename="${filename}.json"`);
    return res.json(clean);
  }
  // CSV por defecto
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}.csv"`);
  res.send('﻿' + toCSV(clean)); // BOM para compatibilidad con Excel
}

function dateFilter(desde, hasta, col, params, conditions) {
  if (desde) { params.push(desde); conditions.push(`${col} >= $${params.length}`); }
  if (hasta) { params.push(hasta); conditions.push(`${col} <= $${params.length}`); }
}

/** GET /api/admin/export/usuarios?formato=csv|json */
export async function exportUsuarios(req, res, next) {
  try {
    const formato = req.query.formato === 'json' ? 'json' : 'csv';
    const { rows } = await query(
      `SELECT id, nombre, email, rol, tipo_acceso, institucion, activo,
              email_verified, last_login_at, creado_en
       FROM usuarios WHERE rol != 'super_admin' ORDER BY creado_en DESC LIMIT $1`,
      [MAX_ROWS]
    );
    if (rows.length === MAX_ROWS) {
      return res.status(400).json({ error: `Más de ${MAX_ROWS} registros. Usa filtros de fecha.` });
    }
    registrarAuditoria({
      accion: 'export_usuarios', modulo: 'admin',
      descripcion: `Export usuarios (${rows.length} registros, ${formato})`,
      usuarioId: req.user.id, usuarioEmail: req.user.email, ip: req.ip,
    });
    sendExport(res, rows, 'usuarios', formato);
  } catch (err) { next(err); }
}

/** GET /api/admin/export/solicitudes?formato=csv|json&desde=&hasta= */
export async function exportSolicitudes(req, res, next) {
  try {
    const formato = req.query.formato === 'json' ? 'json' : 'csv';
    const params = [], conditions = [];
    dateFilter(req.query.desde, req.query.hasta, 'creado_en', params, conditions);
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    params.push(MAX_ROWS);
    const { rows } = await query(
      `SELECT id, tipo, descripcion, estado, nota_admin, creado_en, actualizado_en
       FROM solicitudes ${where} ORDER BY creado_en DESC LIMIT $${params.length}`,
      params
    );
    if (rows.length === MAX_ROWS) {
      return res.status(400).json({ error: `Más de ${MAX_ROWS} registros. Reduce el rango de fechas.` });
    }
    registrarAuditoria({
      accion: 'export_solicitudes', modulo: 'admin',
      descripcion: `Export solicitudes (${rows.length} registros, ${formato})`,
      usuarioId: req.user.id, usuarioEmail: req.user.email, ip: req.ip,
    });
    sendExport(res, rows, 'solicitudes', formato);
  } catch (err) { next(err); }
}

/** GET /api/admin/export/audit?formato=csv|json&desde=&hasta= */
export async function exportAudit(req, res, next) {
  try {
    const formato = req.query.formato === 'json' ? 'json' : 'csv';
    // Excluir acciones del super_admin — nunca visibles para admin_sig
    const params = [], conditions = [
      `usuario_id NOT IN (SELECT id FROM usuarios WHERE rol = 'super_admin')`,
    ];
    dateFilter(req.query.desde, req.query.hasta, 'creado_en', params, conditions);
    const where = `WHERE ${conditions.join(' AND ')}`;
    params.push(MAX_ROWS);
    const { rows } = await query(
      `SELECT id, accion, modulo, entidad_id, descripcion, usuario_email, ip, creado_en
       FROM audit_log ${where} ORDER BY creado_en DESC LIMIT $${params.length}`,
      params
    );
    if (rows.length === MAX_ROWS) {
      return res.status(400).json({ error: `Más de ${MAX_ROWS} registros. Reduce el rango de fechas.` });
    }
    registrarAuditoria({
      accion: 'export_audit', modulo: 'admin',
      descripcion: `Export audit log (${rows.length} registros, ${formato})`,
      usuarioId: req.user.id, usuarioEmail: req.user.email, ip: req.ip,
    });
    sendExport(res, rows, 'audit-log', formato);
  } catch (err) { next(err); }
}

/** GET /api/admin/export/descargas?formato=csv|json */
export async function exportDescargas(req, res, next) {
  try {
    const formato = req.query.formato === 'json' ? 'json' : 'csv';
    const { rows } = await query(
      `SELECT id, archivo_key, usuario_id, ip_origen, descargado_en
       FROM descarga_log ORDER BY descargado_en DESC LIMIT $1`,
      [MAX_ROWS]
    );
    registrarAuditoria({
      accion: 'export_descargas', modulo: 'admin',
      descripcion: `Export descargas (${rows.length} registros, ${formato})`,
      usuarioId: req.user.id, usuarioEmail: req.user.email, ip: req.ip,
    });
    sendExport(res, rows, 'descargas', formato);
  } catch (err) { next(err); }
}
