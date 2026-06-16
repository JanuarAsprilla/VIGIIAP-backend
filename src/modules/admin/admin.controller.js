import { query } from '../../config/database.js';
import * as adminService from './admin.service.js';
import { getCadenaCustodia, getDescargasRecurso } from '../../utils/dataCustody.js';

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

/** PUT /api/admin/configuracion */
export async function setConfiguracion(req, res, next) {
  try {
    if (!req.body || typeof req.body !== 'object') {
      return res.status(400).json({ message: 'Body debe ser un objeto clave→valor' });
    }
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
      return res.status(400).json({ message: 'nombre, email y rol son obligatorios' });
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
