import { z } from 'zod';
import * as tiposService from './tiposNotificacion.service.js';
import { registrarAuditoria } from '../../utils/auditLog.js';

const claveSchema = z.string()
  .min(2, 'Mínimo 2 caracteres').max(50, 'Máximo 50 caracteres')
  .regex(/^[a-z][a-z0-9_]*$/, 'Solo minúsculas, números y guion bajo, debe empezar con letra');

const createSchema = z.object({
  clave:    claveSchema,
  nombre:   z.string().min(2).max(100),
  icono:    z.string().min(1).max(50).default('Bell'),
  color:    z.string().min(1).max(30).default('gold'),
  aplicaA:  z.enum(['admin', 'usuario', 'ambos']).default('ambos'),
  orden:    z.number().int().min(0).default(0),
});

const updateSchema = z.object({
  nombre:   z.string().min(2).max(100).optional(),
  icono:    z.string().min(1).max(50).optional(),
  color:    z.string().min(1).max(30).optional(),
  aplicaA:  z.enum(['admin', 'usuario', 'ambos']).optional(),
  activo:   z.boolean().optional(),
  orden:    z.number().int().min(0).optional(),
}).refine((d) => Object.keys(d).length > 0, { message: 'No hay cambios para aplicar' });

/** GET /api/v1/notificaciones/tipos — cualquier cuenta (filtra su propio panel de preferencias). */
export async function index(req, res, next) {
  try {
    const soloActivos = req.query.admin !== 'true' || !['admin_sig', 'super_admin'].includes(req.user?.rol);
    res.json({ data: await tiposService.listar({ soloActivos }) });
  } catch (err) { next(err); }
}

/** POST /api/v1/notificaciones/tipos — solo super_admin. */
export async function create(req, res, next) {
  try {
    const data = createSchema.parse(req.body);
    const tipo = await tiposService.crear(data);
    registrarAuditoria({
      accion: 'create_tipo_notificacion', modulo: 'notificaciones', entidadId: tipo.clave,
      descripcion: `Tipo de notificación creado: ${tipo.clave}`,
      usuarioId: req.user?.id, usuarioEmail: req.user?.email, ip: req.ip,
    });
    res.status(201).json(tipo);
  } catch (err) { next(err); }
}

/** PATCH /api/v1/notificaciones/tipos/:clave — solo super_admin. */
export async function update(req, res, next) {
  try {
    const cambios = updateSchema.parse(req.body);
    const tipo = await tiposService.actualizar(req.params.clave, cambios);
    registrarAuditoria({
      accion: 'update_tipo_notificacion', modulo: 'notificaciones', entidadId: tipo.clave,
      descripcion: `Tipo de notificación actualizado: ${tipo.clave}`,
      usuarioId: req.user?.id, usuarioEmail: req.user?.email, ip: req.ip,
    });
    res.json(tipo);
  } catch (err) { next(err); }
}

/** DELETE /api/v1/notificaciones/tipos/:clave — solo super_admin (soft delete). */
export async function destroy(req, res, next) {
  try {
    await tiposService.desactivar(req.params.clave);
    registrarAuditoria({
      accion: 'delete_tipo_notificacion', modulo: 'notificaciones', entidadId: req.params.clave,
      descripcion: `Tipo de notificación desactivado: ${req.params.clave}`,
      usuarioId: req.user?.id, usuarioEmail: req.user?.email, ip: req.ip,
    });
    res.status(204).end();
  } catch (err) { next(err); }
}
