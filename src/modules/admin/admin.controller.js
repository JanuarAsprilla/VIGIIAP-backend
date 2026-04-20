import { query } from '../../config/database.js';
import * as adminService from './admin.service.js';

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
    res.status(201).json(usuario);
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
