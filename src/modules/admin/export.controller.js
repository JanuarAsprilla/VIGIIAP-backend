/**
 * export.controller.js — Exportación de datos en CSV y JSON.
 * Sin dependencias externas para evitar vulnerabilidades de parsing (SheetJS CVEs).
 * CSV generado directamente: seguro porque los datos vienen de nuestra BD (no de input externo).
 */
import { query } from '../../config/database.js';
import { registrarAuditoria } from '../../utils/auditLog.js';
import { EXCLUIR_SUPER_ADMIN, SEVERIDADES, condicionSeveridad } from './auditoriaCatalogo.js';
import { lineaCsv, transmitirCsv } from './exportCsv.js';

// Tope de las exportaciones que se arman en memoria (JSON y las tablas pequeñas). El CSV de los
// registros que crecen sin límite (actividad y descargas) se transmite por bloques y no lo usa.
const MAX_ROWS = 10_000;
const AVISO_TOPE_JSON = `Más de ${MAX_ROWS} registros en JSON. Descarga el CSV (formato=csv), que no tiene ese límite, o reduce el rango de fechas.`;

const COLUMNAS_AUDITORIA = 'id, accion, modulo, entidad_id, descripcion, usuario_email, ip, resultado, request_id, creado_en';
// archivo_url se omite a propósito: es la ubicación interna del archivo, no un dato de la descarga.
const COLUMNAS_DESCARGAS = 'id, tipo_recurso, recurso_id, recurso_titulo, usuario_id, usuario_email, ip, created_at';

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
  const lines = rows.map((r) => lineaCsv(headers.map((h) => r[h])));
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

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2}(\.\d+)?)?Z?)?$/;

function parseDateParam(raw, fieldName) {
  if (!raw) return null;
  if (!ISO_DATE_RE.test(raw) || isNaN(Date.parse(raw))) {
    throw Object.assign(
      new Error(`Parámetro '${fieldName}' no es una fecha válida (usa formato ISO 8601: YYYY-MM-DD)`),
      { status: 422 },
    );
  }
  return raw;
}

function dateFilter(desde, hasta, col, params, conditions) {
  const d = parseDateParam(desde, 'desde');
  const h = parseDateParam(hasta, 'hasta');
  if (d) { params.push(d); conditions.push(`${col} >= $${params.length}`); }
  if (h) { params.push(h); conditions.push(`${col} <= $${params.length}`); }
}

/** GET /api/admin/export/usuarios?formato=csv|json */
export async function exportUsuarios(req, res, next) {
  try {
    const formato = req.query.formato === 'json' ? 'json' : 'csv';
    const { rows } = await query(
      `SELECT id, nombre, email, rol, tipo_acceso, institucion, activo,
              email_verified, last_login_at, creado_en
       FROM usuarios WHERE rol NOT IN ('super_admin', 'admin_sig') ORDER BY creado_en DESC LIMIT $1`,
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

const RESULTADOS = ['exito', 'fallo', 'denegado'];
const IP_VALIDA = /^[0-9a-fA-F:.]{1,45}$/;

/** Filtros de la pantalla de Actividad que también aplican al export (valores desconocidos se ignoran). */
function filtrosAuditoria({ modulo, accion, severidad, resultado, usuario, ip }, params, conditions) {
  if (modulo) { params.push(String(modulo).slice(0, 100)); conditions.push(`modulo = $${params.length}`); }
  if (accion) { params.push(String(accion).slice(0, 100)); conditions.push(`accion = $${params.length}`); }
  if (SEVERIDADES.includes(severidad)) conditions.push(condicionSeveridad(severidad, params));
  if (RESULTADOS.includes(resultado)) { params.push(resultado); conditions.push(`resultado = $${params.length}`); }
  if (usuario) { params.push(`%${String(usuario).slice(0, 255)}%`); conditions.push(`usuario_email ILIKE $${params.length}`); }
  if (ip && IP_VALIDA.test(ip)) { params.push(`${ip}%`); conditions.push(`ip LIKE $${params.length}`); }
}

/** GET /api/admin/export/audit?formato=csv|json&desde=&hasta=&modulo=&accion=&severidad=&resultado=&usuario=&ip= */
export async function exportAudit(req, res, next) {
  try {
    const formato = req.query.formato === 'json' ? 'json' : 'csv';
    // Excluir acciones del super_admin — nunca visibles para admin_sig, pero
    // SÍ visibles cuando quien exporta es otro super_admin (ver mismo
    // criterio en getAuditLog, admin.service.js).
    const params = [], conditions = req.user?.rol === 'super_admin' ? [] : [EXCLUIR_SUPER_ADMIN];
    dateFilter(req.query.desde, req.query.hasta, 'creado_en', params, conditions);
    filtrosAuditoria(req.query, params, conditions);
    const auditar = (total) => registrarAuditoria({
      accion: 'export_audit', modulo: 'admin',
      descripcion: `Export audit log (${total} registros, ${formato})`,
      usuarioId: req.user.id, usuarioEmail: req.user.email, ip: req.ip,
    });
    if (formato === 'csv') {
      await transmitirCsv({
        res, nombreArchivo: 'audit-log', tabla: 'audit_log', columnas: COLUMNAS_AUDITORIA, columnaFecha: 'creado_en',
        condiciones: conditions, params, excluir: EXCLUDED, alIniciar: auditar,
      });
      return;
    }
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    params.push(MAX_ROWS);
    const { rows } = await query(
      `SELECT ${COLUMNAS_AUDITORIA}
       FROM audit_log ${where} ORDER BY creado_en DESC LIMIT $${params.length}`,
      params
    );
    if (rows.length === MAX_ROWS) {
      return res.status(400).json({ error: AVISO_TOPE_JSON });
    }
    auditar(rows.length);
    sendExport(res, rows, 'audit-log', formato);
  } catch (err) { next(err); }
}

/** GET /api/admin/export/descargas?formato=csv|json */
export async function exportDescargas(req, res, next) {
  try {
    const formato = req.query.formato === 'json' ? 'json' : 'csv';
    if (formato === 'csv') {
      await transmitirCsv({
        res, nombreArchivo: 'descargas', tabla: 'descarga_log', columnas: COLUMNAS_DESCARGAS, columnaFecha: 'created_at',
        excluir: EXCLUDED,
        alIniciar: (total) => registrarAuditoria({
          accion: 'export_descargas', modulo: 'admin',
          descripcion: `Export descargas (${total} registros, csv)`,
          usuarioId: req.user.id, usuarioEmail: req.user.email, ip: req.ip,
        }),
      });
      return;
    }
    const { rows } = await query(
      `SELECT ${COLUMNAS_DESCARGAS}
       FROM descarga_log ORDER BY created_at DESC LIMIT $1`,
      [MAX_ROWS]
    );
    if (rows.length === MAX_ROWS) {
      return res.status(400).json({ error: AVISO_TOPE_JSON });
    }
    registrarAuditoria({
      accion: 'export_descargas', modulo: 'admin',
      descripcion: `Export descargas (${rows.length} registros, ${formato})`,
      usuarioId: req.user.id, usuarioEmail: req.user.email, ip: req.ip,
    });
    sendExport(res, rows, 'descargas', formato);
  } catch (err) { next(err); }
}
