import { z } from 'zod';
import * as servicio from './actualizacion.service.js';
import { registrarAuditoria } from '../../../utils/auditLog.js';

const ajustesSchema = z.strictObject({
  modo: z.enum(['publico', 'cuenta']).optional(),
  activa: z.boolean().optional(),
  frecuencia_dias: z.number().int().min(7).max(90).optional(),
  credencial_usuario_id: z.string().uuid().nullable().optional(),
}).refine((d) => Object.keys(d).length > 0, { message: 'No hay campos para actualizar' });

const credencialSchema = z.strictObject({
  gbif_usuario: z.string().trim().min(3, 'Mínimo 3 caracteres').max(100),
  gbif_correo: z.string().trim().email('Correo inválido').max(200),
  clave: z.string().min(6, 'Mínimo 6 caracteres').max(200),
  usuario_id: z.string().uuid().optional(),
});
const solicitudSchema = z.strictObject({ tarea: z.enum(servicio.TAREAS) });
const usuarioQuerySchema = z.object({ usuario_id: z.string().uuid().optional() });

const esSuperAdmin = (req) => req.user?.rol === 'super_admin';
const auditar = (req, accion, descripcion, entidadId = null) => registrarAuditoria({
  accion, modulo: 'biodiversidad_datos', entidadId, descripcion,
  usuarioId: req.user?.id, usuarioEmail: req.user?.email, ip: req.ip,
});
const invalido = (res, resultado) => res.status(400).json({ error: resultado.error.issues[0].message });

/** La credencial propia se gestiona con el módulo en «editar»; la de otra persona solo la gestiona el super administrador. */
function usuarioObjetivo(req, res, pedido) {
  const objetivo = pedido ?? req.user.id;
  if (objetivo !== req.user.id && !esSuperAdmin(req)) {
    res.status(403).json({ error: 'Solo el super administrador puede gestionar la cuenta de otra persona' });
    return null;
  }
  return objetivo;
}

export async function ver(req, res, next) {
  try {
    res.json(await servicio.estado({ usuarioId: req.user.id, esSuperAdmin: esSuperAdmin(req) }));
  } catch (err) { next(err); }
}

export async function ejecuciones(req, res, next) {
  try {
    res.json({ ejecuciones: await servicio.listarEjecuciones(req.query.limite) });
  } catch (err) { next(err); }
}

export async function cambiarAjustes(req, res, next) {
  try {
    const r = ajustesSchema.safeParse(req.body);
    if (!r.success) return invalido(res, r);
    const { antes, despues } = await servicio.actualizarAjustes(req.user.id, r.data);
    auditar(req, 'update_biodiversidad_actualizacion', `Ajustes de actualización de biodiversidad: modo ${antes.modo}→${despues.modo}, activa ${antes.activa}→${despues.activa}, cada ${despues.frecuencia_dias} días`);
    res.json({ ok: true });
  } catch (err) { next(err); }
}

export async function guardarCredencial(req, res, next) {
  try {
    const r = credencialSchema.safeParse(req.body);
    if (!r.success) return invalido(res, r);
    const objetivo = usuarioObjetivo(req, res, r.data.usuario_id);
    if (!objetivo) return undefined;
    await servicio.guardarCredencial(objetivo, r.data);
    auditar(req, 'update_biodiversidad_credencial', 'Cuenta de GBIF guardada para la actualización de biodiversidad (la clave no se registra)', objetivo);
    res.json({ ok: true });
  } catch (err) { next(err); }
}

export async function borrarCredencial(req, res, next) {
  try {
    const r = usuarioQuerySchema.safeParse(req.query);
    if (!r.success) return invalido(res, r);
    const objetivo = usuarioObjetivo(req, res, r.data.usuario_id);
    if (!objetivo) return undefined;
    await servicio.borrarCredencial(objetivo);
    auditar(req, 'delete_biodiversidad_credencial', 'Cuenta de GBIF eliminada de la actualización de biodiversidad', objetivo);
    res.status(204).end();
  } catch (err) { next(err); }
}

export async function solicitar(req, res, next) {
  try {
    const r = solicitudSchema.safeParse(req.body);
    if (!r.success) return invalido(res, r);
    const creada = await servicio.solicitar(req.user.id, r.data.tarea);
    auditar(req, 'create_biodiversidad_actualizacion', `Actualización solicitada: ${r.data.tarea}`, String(creada.id));
    res.status(202).json(creada);
  } catch (err) { next(err); }
}
