import { z } from 'zod';
import * as categoriasService from './categorias.service.js';
import { registrarAuditoria } from '../../utils/auditLog.js';
import { invalidateCache } from '../../middlewares/cache.js';

export async function index(req, res, next) {
  try {
    res.json(await categoriasService.getAll());
  } catch (err) { next(err); }
}

export async function upsertThumbnail(req, res, next) {
  try {
    const nombre = decodeURIComponent(req.params.nombre);
    const thumbnailUrl = req.body.thumbnail_url ?? null;
    const result = await categoriasService.updateThumbnail(nombre, thumbnailUrl);
    invalidateCache('cache:/api/categorias*').catch(() => {});
    invalidateCache('cache:/api/v1/categorias*').catch(() => {});
    registrarAuditoria({
      accion: 'update_categoria_thumbnail', modulo: 'categorias', entidadId: nombre,
      descripcion: `Thumbnail actualizado para categoría: ${nombre}`,
      usuarioId: req.user?.id, usuarioEmail: req.user?.email, ip: req.ip,
    });
    res.json(result);
  } catch (err) { next(err); }
}

const nombreSchema = z.string()
  .min(2, 'Mínimo 2 caracteres')
  .max(100, 'Máximo 100 caracteres')
  .regex(/^[\p{L}\p{N}\s\-_.]+$/u, 'Solo se permiten letras, números, espacios y - _ .');

export async function create(req, res, next) {
  try {
    const parseResult = nombreSchema.safeParse(req.body?.nombre?.trim());
    if (!parseResult.success) {
      return res.status(400).json({ error: parseResult.error.errors[0].message });
    }
    const nombre = parseResult.data;
    const result = await categoriasService.upsert(nombre);
    invalidateCache('cache:/api/categorias*').catch(() => {});
    invalidateCache('cache:/api/v1/categorias*').catch(() => {});
    registrarAuditoria({
      accion: 'create_categoria', modulo: 'categorias', entidadId: nombre.trim(),
      descripcion: `Categoría creada: ${nombre.trim()}`,
      usuarioId: req.user?.id, usuarioEmail: req.user?.email, ip: req.ip,
    });
    res.status(201).json(result);
  } catch (err) { next(err); }
}

export async function destroy(req, res, next) {
  try {
    const nombre = decodeURIComponent(req.params.nombre);
    await categoriasService.remove(nombre);
    invalidateCache('cache:/api/categorias*').catch(() => {});
    invalidateCache('cache:/api/v1/categorias*').catch(() => {});
    registrarAuditoria({
      accion: 'delete_categoria', modulo: 'categorias', entidadId: nombre,
      descripcion: `Categoría eliminada (soft): ${nombre}`,
      usuarioId: req.user?.id, usuarioEmail: req.user?.email, ip: req.ip,
    });
    res.status(204).end();
  } catch (err) { next(err); }
}
