import { createSolicitudSchema, updateEstadoSchema } from './solicitudes.schema.js';
import * as solService from './solicitudes.service.js';
import { notifySolicitudEstado, notifyAdminNuevaSolicitud } from '../../utils/mailer.js';
import { getAdminEmails } from '../admin/admin.service.js';
import { registrarAuditoria } from '../../utils/auditLog.js';
import { query } from '../../config/database.js';

export async function index(req, res, next) {
  try { res.json(await solService.getAll(req.query)); } catch (err) { next(err); }
}

export async function mine(req, res, next) {
  try { res.json(await solService.getMine(req.user.id, req.query)); } catch (err) { next(err); }
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
      getAdminEmails().then((adminEmails) => {
        adminEmails.forEach((adminEmail) =>
          notifyAdminNuevaSolicitud({
            adminEmail,
            solicitante:  solicitante.nombre,
            email:        solicitante.email,
            tipo:         data.tipo,
            descripcion:  data.descripcion,
          })
        );
      });
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
      });
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
