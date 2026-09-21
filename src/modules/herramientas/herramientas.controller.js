import { z } from 'zod';
import * as herramientasService from './herramientas.service.js';
import { registrarAuditoria } from '../../utils/auditLog.js';
import { invalidateCache } from '../../middlewares/cache.js';

const claveSchema = z.string().regex(/^[a-z0-9-]{2,50}$/, 'Solo minúsculas, números y guiones (2-50 caracteres)');
const tituloSchema = z.string().min(2, 'Mínimo 2 caracteres').max(150, 'Máximo 150 caracteres');
const descripcionSchema = z.string().max(500, 'Máximo 500 caracteres').nullable().optional();
const tagSchema = z.string().min(2, 'Mínimo 2 caracteres').max(40, 'Máximo 40 caracteres');
const ordenSchema = z.number().int().min(0).optional();

const crearSchema = z.object({
  clave: claveSchema,
  titulo: tituloSchema,
  descripcion: descripcionSchema,
  tag: tagSchema,
  orden: ordenSchema,
});

const actualizarSchema = z.object({
  titulo: tituloSchema.optional(),
  descripcion: descripcionSchema,
  tag: tagSchema.optional(),
  activa: z.boolean().optional(),
  orden: z.number().int().min(0).optional(),
}).refine((datos) => Object.keys(datos).length > 0, { message: 'No hay campos para actualizar' });

const reordenarSchema = z.array(
  z.object({ clave: claveSchema, orden: z.number().int().min(0) }),
).min(1, 'Se requiere al menos una herramienta');

function invalidarCacheHerramientas() {
  invalidateCache('cache:/api/herramientas*').catch(() => {});
  invalidateCache('cache:/api/v1/herramientas*').catch(() => {});
}

export async function index(req, res, next) {
  try {
    const isAdminView = req.query.admin === 'true' && ['admin_sig', 'super_admin'].includes(req.user?.rol);
    res.json(await herramientasService.listar(isAdminView));
  } catch (err) { next(err); }
}

export async function create(req, res, next) {
  try {
    const parseResult = crearSchema.safeParse(req.body);
    if (!parseResult.success) {
      return res.status(400).json({ error: parseResult.error.errors[0].message });
    }
    const result = await herramientasService.crear(parseResult.data);
    invalidarCacheHerramientas();
    registrarAuditoria({
      accion: 'create_herramienta', modulo: 'herramientas', entidadId: result.clave,
      descripcion: `Herramienta creada: ${result.clave} (${result.titulo})`,
      usuarioId: req.user?.id, usuarioEmail: req.user?.email, ip: req.ip,
    });
    res.status(201).json(result);
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({ error: 'Ya existe una herramienta con esa clave' });
    }
    next(err);
  }
}

export async function update(req, res, next) {
  try {
    const clave = decodeURIComponent(req.params.clave);
    const parseResult = actualizarSchema.safeParse(req.body);
    if (!parseResult.success) {
      return res.status(400).json({ error: parseResult.error.errors[0].message });
    }
    const result = await herramientasService.actualizar(clave, parseResult.data);
    invalidarCacheHerramientas();
    registrarAuditoria({
      accion: 'update_herramienta', modulo: 'herramientas', entidadId: clave,
      descripcion: `Herramienta actualizada: ${clave} (${Object.keys(parseResult.data).join(', ')})`,
      usuarioId: req.user?.id, usuarioEmail: req.user?.email, ip: req.ip,
    });
    res.json(result);
  } catch (err) { next(err); }
}

export async function reorder(req, res, next) {
  try {
    const parseResult = reordenarSchema.safeParse(req.body);
    if (!parseResult.success) {
      return res.status(400).json({ error: parseResult.error.errors[0].message });
    }
    await herramientasService.reordenar(parseResult.data);
    invalidarCacheHerramientas();
    registrarAuditoria({
      accion: 'reorder_herramientas', modulo: 'herramientas', entidadId: null,
      descripcion: `Orden actualizado: ${parseResult.data.map((p) => p.clave).join(', ')}`,
      usuarioId: req.user?.id, usuarioEmail: req.user?.email, ip: req.ip,
    });
    res.json(await herramientasService.listar(true));
  } catch (err) { next(err); }
}

export async function destroy(req, res, next) {
  try {
    const clave = decodeURIComponent(req.params.clave);
    await herramientasService.eliminar(clave);
    invalidarCacheHerramientas();
    registrarAuditoria({
      accion: 'delete_herramienta', modulo: 'herramientas', entidadId: clave,
      descripcion: `Herramienta eliminada (soft): ${clave}`,
      usuarioId: req.user?.id, usuarioEmail: req.user?.email, ip: req.ip,
    });
    res.status(204).end();
  } catch (err) { next(err); }
}
