import { query } from '../../config/database.js';
import * as adminService from './admin.service.js';
import { getCadenaCustodia, getDescargasRecurso } from '../../utils/dataCustody.js';
import { registrarAuditoria } from '../../utils/auditLog.js';

/** GET /api/admin/notificaciones */
export async function notificaciones(req, res, next) {
  try {
    res.json(await adminService.getNotificaciones());
  } catch (err) { next(err); }
}

/** GET /api/admin/configuracion */
export async function getConfiguracion(req, res, next) {
  try {
    res.json(await adminService.getConfiguracion());
  } catch (err) { next(err); }
}

// Claves permitidas para configuración del sistema (ver migración 005_configuracion.sql)
const CONFIG_SCHEMA = {
  siteName:             { type: 'string', maxLength: 100 },
  siteDesc:             { type: 'string', maxLength: 500 },
  region:               { type: 'string', maxLength: 200 },
  email:                { type: 'string', maxLength: 254 },
  phone:                { type: 'string', maxLength: 50 },
  address:              { type: 'string', maxLength: 300 },
  modoMantenimiento:    { type: 'boolean' },
  mensajeMantenimiento: { type: 'string', maxLength: 1000 },
};

/** PUT /api/admin/configuracion */
export async function setConfiguracion(req, res, next) {
  try {
    if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) {
      return res.status(400).json({ error: 'Body debe ser un objeto clave→valor' });
    }

    const unknownKeys = Object.keys(req.body).filter((k) => !CONFIG_SCHEMA[k]);
    if (unknownKeys.length) {
      return res.status(400).json({ error: `Claves no permitidas: ${unknownKeys.join(', ')}` });
    }

    const errors = [];
    for (const [key, value] of Object.entries(req.body)) {
      const rule = CONFIG_SCHEMA[key];
      if (rule.type === 'boolean' && typeof value !== 'boolean' && value !== 'true' && value !== 'false') {
        errors.push(`'${key}' debe ser booleano`);
      } else if (rule.type === 'string') {
        if (typeof value !== 'string') { errors.push(`'${key}' debe ser texto`); continue; }
        if (rule.maxLength && value.length > rule.maxLength) {
          errors.push(`'${key}' supera el máximo de ${rule.maxLength} caracteres`);
        }
      }
    }
    if (errors.length) return res.status(400).json({ error: errors.join('; ') });

    await adminService.setConfiguracion(req.body, req.user.id, req.user.email);
    res.json({ message: 'Configuración guardada' });
  } catch (err) { next(err); }
}

/** GET /api/admin/stats */
export async function stats(req, res, next) {
  try {
    const [usuarios, solicitudes, documentos, noticias, visitantes] = await Promise.all([
      query('SELECT COUNT(*) FROM usuarios WHERE activo = true'),
      query("SELECT COUNT(*) FROM solicitudes WHERE estado IN ('pendiente','en_revision')"),
      query('SELECT COUNT(*) FROM documentos WHERE activo = true'),
      query('SELECT COUNT(*) FROM noticias WHERE publicado = true'),
      query("SELECT COUNT(*) FROM visitantes WHERE creado_en >= NOW() - INTERVAL '30 days'"),
    ]);

    res.json({
      usuarios:              Number(usuarios.rows[0].count),
      solicitudesPendientes: Number(solicitudes.rows[0].count),
      documentos:            Number(documentos.rows[0].count),
      noticias:              Number(noticias.rows[0].count),
      visitantesUltimos30d:  Number(visitantes.rows[0].count),
    });
  } catch (err) {
    next(err);
  }
}

/** GET /api/admin/usuarios */
export async function listarUsuarios(req, res, next) {
  try {
    const result = await adminService.listarUsuarios(req.query);
    res.json(result);
  } catch (err) {
    next(err);
  }
}

/** POST /api/admin/usuarios */
export async function crearUsuario(req, res, next) {
  try {
    const { nombre, email, rol, institucion, tipoAcceso } = req.body;
    if (!nombre || !email || !rol) {
      return res.status(400).json({ error: 'nombre, email y rol son obligatorios' });
    }
    const usuario = await adminService.crearUsuario({
      nombre,
      email,
      rol,
      institucion,
      tipoAcceso,
      adminId:    req.user.id,
      adminEmail: req.user.email,
    });
    const { _passwordTemporal, ...usuarioSafe } = usuario;
    res.status(201).json(usuarioSafe);
  } catch (err) {
    next(err);
  }
}

/** PATCH /api/admin/usuarios/:id */
export async function actualizarUsuario(req, res, next) {
  try {
    const { rol, activo } = req.body;
    const usuario = await adminService.actualizarUsuario({
      id:         req.params.id,
      rol,
      activo:     activo !== undefined ? Boolean(activo) : undefined,
      adminId:    req.user.id,
      adminEmail: req.user.email,
    });
    res.json(usuario);
  } catch (err) {
    next(err);
  }
}

/** DELETE /api/admin/usuarios/:id */
export async function eliminarUsuario(req, res, next) {
  try {
    await adminService.eliminarUsuario({
      id:         req.params.id,
      adminId:    req.user.id,
      adminEmail: req.user.email,
    });
    res.status(204).end();
  } catch (err) {
    next(err);
  }
}

/** GET /api/admin/audit */
export async function auditLog(req, res, next) {
  try {
    const result = await adminService.getAuditLog(req.query);
    res.json(result);
  } catch (err) {
    next(err);
  }
}

/** GET /api/admin/super/stats — exclusivo super_admin */
export async function superStats(req, res, next) {
  try {
    res.json(await adminService.getSuperStats());
  } catch (err) { next(err); }
}

/** POST /api/admin/super/crear-admin — exclusivo super_admin */
export async function crearAdmin(req, res, next) {
  try {
    const { nombre, email, institucion } = req.body;
    if (!nombre || !email) {
      return res.status(400).json({ error: 'nombre y email son obligatorios' });
    }
    const usuario = await adminService.crearAdminSig({
      nombre, email, institucion,
      superAdminId: req.user.id,
    });
    const { _passwordTemporal: _p, ...adminSafe } = usuario;
    res.status(201).json(adminSafe);
  } catch (err) { next(err); }
}

/** GET /api/admin/custodia?tipo=mapa&id=UUID */
export async function custodiaRecurso(req, res, next) {
  try {
    const { tipo, id } = req.query;
    if (!tipo || !id) {
      return res.status(400).json({ error: 'Parámetros requeridos: tipo (mapa|documento) e id (UUID)' });
    }
    if (!['mapa', 'documento'].includes(tipo)) {
      return res.status(400).json({ error: 'tipo debe ser "mapa" o "documento"' });
    }
    const rows = await getCadenaCustodia(tipo, id);
    res.json({ data: rows });
  } catch (err) { next(err); }
}

/** GET /api/admin/descargas?tipo=mapa&id=UUID */
export async function descargasRecurso(req, res, next) {
  try {
    const { tipo, id } = req.query;
    if (!tipo || !id) {
      return res.status(400).json({ error: 'Parámetros requeridos: tipo (mapa|documento) e id (UUID)' });
    }
    if (!['mapa', 'documento'].includes(tipo)) {
      return res.status(400).json({ error: 'tipo debe ser "mapa" o "documento"' });
    }
    const rows = await getDescargasRecurso(tipo, id);
    res.json({ data: rows });
  } catch (err) { next(err); }
}

/** GET /api/admin/descargas/stats */
export async function descargasStats(req, res, next) {
  try {
    const { rows } = await query(
      `SELECT tipo_recurso, recurso_id, recurso_titulo,
              total_descargas, usuarios_unicos, ultima_descarga
       FROM v_descargas_stats
       ORDER BY total_descargas DESC
       LIMIT 100`,
    );
    res.json({ data: rows });
  } catch (err) { next(err); }
}

/** GET /api/admin/scan-log?resultado=rejected&limit=50 */
export async function scanLog(req, res, next) {
  try {
    const resultado = req.query.resultado ?? null;
    const limit     = Math.min(Number(req.query.limit) || 50, 200);

    const conditions = [];
    const params     = [];

    if (resultado && ['clean', 'rejected', 'suspicious'].includes(resultado)) {
      params.push(resultado);
      conditions.push(`resultado = $${params.length}`);
    }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    params.push(limit);

    const { rows } = await query(
      `SELECT id, archivo_key, sha256_hash, mime_type, tamano_bytes,
              uploaded_by, ip_origen, resultado, detalle, created_at
       FROM file_scan_log
       ${where}
       ORDER BY created_at DESC
       LIMIT $${params.length}`,
      params,
    );
    res.json({ data: rows });
  } catch (err) { next(err); }
}

/** PATCH /api/admin/usuarios/batch — activar/desactivar/cambiar-rol en lote */
export async function batchUsuarios(req, res, next) {
  try {
    const { ids, accion, rol } = req.body;
    if (!Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ error: 'ids debe ser un array no vacío' });
    }
    if (ids.length > 50) {
      return res.status(400).json({ error: 'Máximo 50 usuarios por operación batch' });
    }
    const ACCIONES = ['activar', 'desactivar', 'cambiar-rol'];
    if (!ACCIONES.includes(accion)) {
      return res.status(400).json({ error: `accion debe ser uno de: ${ACCIONES.join(', ')}` });
    }
    const ROLES_BATCH = ['admin_sig', 'investigador', 'tecnico', 'institucional', 'publico'];
    if (accion === 'cambiar-rol' && !ROLES_BATCH.includes(rol)) {
      return res.status(400).json({ error: `rol inválido. Opciones: ${ROLES_BATCH.join(', ')}` });
    }
    // Solo super_admin puede promover a admin_sig
    if (accion === 'cambiar-rol' && rol === 'admin_sig' && req.user.rol !== 'super_admin') {
      return res.status(403).json({ error: 'Solo el super_admin puede asignar el rol admin_sig' });
    }

    // Proteger contra auto-operación y cuentas super_admin
    if (ids.includes(req.user.id)) {
      return res.status(400).json({ error: 'No puedes operar sobre tu propia cuenta en batch' });
    }
    const { rows: targets } = await query(
      'SELECT id, rol FROM usuarios WHERE id = ANY($1::uuid[])', [ids]
    );
    if (targets.some((u) => u.rol === 'super_admin')) {
      return res.status(403).json({ error: 'No se puede operar sobre cuentas super_admin en batch' });
    }
    // admin_sig no puede desactivar ni cambiar rol de otros admin_sig
    if (req.user.rol !== 'super_admin' && ['desactivar', 'cambiar-rol'].includes(accion)) {
      if (targets.some((u) => u.rol === 'admin_sig')) {
        return res.status(403).json({ error: 'No puedes operar sobre otros admin_sig' });
      }
    }

    let sql;
    const params = [ids];
    if (accion === 'activar')    sql = 'UPDATE usuarios SET activo = true,  actualizado_en = NOW() WHERE id = ANY($1::uuid[])';
    if (accion === 'desactivar') sql = 'UPDATE usuarios SET activo = false, actualizado_en = NOW() WHERE id = ANY($1::uuid[])';
    if (accion === 'cambiar-rol') {
      sql = 'UPDATE usuarios SET rol = $2, actualizado_en = NOW() WHERE id = ANY($1::uuid[])';
      params.push(rol);
    }

    const result = await query(sql, params);

    registrarAuditoria({
      accion:       `batch_${accion.replace('-', '_')}`,
      modulo:       'admin',
      descripcion:  `Batch ${accion}: ${result.rowCount} usuarios afectados`,
      usuarioId:    req.user.id,
      usuarioEmail: req.user.email,
      ip:           req.ip,
      metadatos:    { ids, accion, rol: rol ?? null, afectados: result.rowCount },
    });

    res.json({ message: `${result.rowCount} usuarios actualizados`, afectados: result.rowCount });
  } catch (err) { next(err); }
}
