import { createSolicitudSchema, updateEstadoSchema, responderSchema } from './solicitudes.schema.js';
import * as solService from './solicitudes.service.js';
import { notifySolicitudEstado, notifyAdminNuevaSolicitud, notifySolicitudRespuesta } from '../../utils/mailer.js';
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
    res.json(await solService.getById(req.params.id, req.user.id, req.user.rol));
  } catch (err) { next(err); }
}

export async function listArchivos(req, res, next) {
  try {
    res.json(await solService.getArchivos(req.params.id));
  } catch (err) { next(err); }
}

export async function uploadArchivo(req, res, next) {
  try {
    const archivoUrl = req.body.archivo_url;
    if (!archivoUrl) return res.status(400).json({ error: 'Archivo requerido' });
    const archivo = await solService.addArchivo(
      req.params.id,
      {
        nombre:       req.body.nombre ?? req.file?.originalname ?? 'archivo',
        archivo_url:  archivoUrl,
        tamano_bytes: req.body.archivo_tamano_bytes ? Number(req.body.archivo_tamano_bytes) : 0,
        mime_type:    req.file?.mimetype ?? req.body.mime_type,
      },
      req.user.id,
    );
    res.status(201).json(archivo);
  } catch (err) { next(err); }
}

export async function deleteArchivo(req, res, next) {
  try {
    await solService.removeArchivo(req.params.id, req.params.archivoId);
    res.status(204).end();
  } catch (err) { next(err); }
}

export async function downloadArchivo(req, res, next) {
  try {
    const result = await solService.getArchivoPresignedUrl(req.params.id, req.params.archivoId);
    res.json(result);
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
    const solicitud = await solService.updateEstado(req.params.id, estado, nota, req.user.id);

    // Obtener datos del usuario dueño de la solicitud
    const { rows } = await query(
      `SELECT u.nombre, u.email, s.tipo
       FROM solicitudes s JOIN usuarios u ON u.id = s.usuario_id
       WHERE s.id = $1`,
      [req.params.id]
    );
    const owner = rows[0];

    if (owner) {
      notifySolicitudEstado({
        email:  owner.email,
        nombre: owner.nombre,
        tipo:   owner.tipo,
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
