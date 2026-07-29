import { createSolicitudSchema, updateEstadoSchema, responderSchema } from './solicitudes.schema.js';
import * as solService from './solicitudes.service.js';
import { notifySolicitudEstado, notifyAdminNuevaSolicitud, notifySolicitudRespuesta, notifySolicitudRecibida } from '../../utils/mailer.js';
import { getAdminEmails } from '../admin/admin.service.js';
import { registrarAuditoria } from '../../utils/auditLog.js';
import { query } from '../../config/database.js';
import logger from '../../utils/logger.js';

export async function index(req, res, next) {
  try { res.json(await solService.getAll(req.query)); } catch (err) { next(err); }
}

export async function mine(req, res, next) {
  try { res.json(await solService.getMine(req.user.id, req.query)); } catch (err) { next(err); }
}

export async function show(req, res, next) {
  try {
    const isAdmin = ['admin_sig', 'super_admin'].includes(req.user.rol);
    res.json(await solService.getById(req.params.id, req.user.id, isAdmin));
  } catch (err) { next(err); }
}

export async function store(req, res, next) {
  try {
    const data = createSolicitudSchema.parse(req.body);
    const solicitud = await solService.create(data, req.user.id);

    // Obtener datos del solicitante para notificar a admins
    const { rows } = await query(
      'SELECT nombre, email FROM usuarios WHERE id = $1',
      [req.user.id]
    );
    const solicitante = rows[0];

    if (solicitante) {
      // Confirmación al solicitante
      notifySolicitudRecibida({
        email:  solicitante.email,
        nombre: solicitante.nombre,
        tipo:   data.tipo,
      }).catch(err => logger.error('[solicitudes] Email recibida error:', err.message));

      // Aviso a todos los admins
      getAdminEmails()
        .then((adminEmails) =>
          adminEmails.forEach((adminEmail) =>
            notifyAdminNuevaSolicitud({
              adminEmail,
              solicitante:  solicitante.nombre,
              email:        solicitante.email,
              tipo:         data.tipo,
              descripcion:  data.descripcion,
            }).catch(err => logger.error('[solicitudes] Email admin error:', err.message))
          )
        )
        .catch(err => logger.error('[solicitudes] getAdminEmails error:', err.message));
    }

    registrarAuditoria({
      accion:      'create_solicitud',
      modulo:      'solicitudes',
      entidadId:   solicitud.id,
      descripcion: `Nueva solicitud tipo "${data.tipo}"`,
      usuarioId:   req.user.id,
      usuarioEmail: req.user.email,
      ip:          req.ip,
    });

    res.status(201).json(solicitud);
  } catch (err) { next(err); }
}

export async function updateEstado(req, res, next) {
  try {
    const { estado, nota } = updateEstadoSchema.parse(req.body);
    // El servicio devuelve la solicitud + owner_nombre/owner_email en un solo roundtrip
    const solicitud = await solService.updateEstado(req.params.id, estado, nota, req.user.id);

    if (solicitud?.owner_email) {
      notifySolicitudEstado({
        email:  solicitud.owner_email,
        nombre: solicitud.owner_nombre,
        tipo:   solicitud.tipo,
        estado,
        nota,
      }).catch(err => logger.error('[solicitudes] Email estado error:', err.message));
    }

    registrarAuditoria({
      accion:      'update_solicitud_estado',
      modulo:      'solicitudes',
      entidadId:   req.params.id,
      descripcion: `Solicitud cambiada a "${estado}"${nota ? ` — nota: ${nota}` : ''}`,
      usuarioId:   req.user.id,
      usuarioEmail: req.user.email,
      ip:          req.ip,
    });

    res.json(solicitud);
  } catch (err) { next(err); }
}

export async function uploadArchivo(req, res, next) {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'Se requiere un archivo' });
    }
    const isAdmin = ['admin_sig', 'super_admin'].includes(req.user.rol);
    const archivo = await solService.addArchivo(
      req.params.id, req.file, req.user.id, isAdmin, req.ip
    );
    res.status(201).json(archivo);
  } catch (err) { next(err); }
}

export async function getArchivos(req, res, next) {
  try {
    const isAdmin = ['admin_sig', 'super_admin'].includes(req.user.rol);
    const archivos = await solService.getArchivos(req.params.id, req.user.id, isAdmin);
    res.json(archivos);
  } catch (err) { next(err); }
}

export async function downloadArchivo(req, res, next) {
  try {
    const isAdmin = ['admin_sig', 'super_admin'].includes(req.user.rol);
    const result = await solService.getArchivoPresignedUrl(
      req.params.id, req.params.archivoId, req.user.id, isAdmin
    );
    res.json(result);
  } catch (err) { next(err); }
}

export async function deleteArchivo(req, res, next) {
  try {
    await solService.removeArchivo(req.params.id, req.params.archivoId, req.user.id);
    res.status(204).end();
  } catch (err) { next(err); }
}

export async function responder(req, res, next) {
  try {
    const { respuesta } = responderSchema.parse(req.body);
    const solicitud = await solService.responder(req.params.id, respuesta, req.user.id);

    const { rows } = await query(
      `SELECT u.nombre, u.email, s.tipo
       FROM solicitudes s JOIN usuarios u ON u.id = s.usuario_id
       WHERE s.id = $1`,
      [req.params.id]
    );
    const owner = rows[0];

    if (owner) {
      notifySolicitudRespuesta({
        email:    owner.email,
        nombre:   owner.nombre,
        tipo:     owner.tipo,
        respuesta,
      }).catch(err => logger.error('[solicitudes] Email respuesta error:', err.message));
    }

    registrarAuditoria({
      accion:      'responder_solicitud',
      modulo:      'solicitudes',
      entidadId:   req.params.id,
      descripcion: `Solicitud resuelta con respuesta del administrador`,
      usuarioId:   req.user.id,
      usuarioEmail: req.user.email,
      ip:          req.ip,
    });

    res.json(solicitud);
  } catch (err) { next(err); }
}
