import { z } from 'zod';
import * as categoriasService from './categorias.service.js';
import { registrarAuditoria } from '../../utils/auditLog.js';
import { invalidateCache } from '../../middlewares/cache.js';

export async function index(req, res, next) {
  try {
    res.json(await categoriasService.getAll(req.query, req.user));
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

const modulosSchema = z.array(z.enum(['documentos', 'mapas', 'geovisores']))
  .min(1, 'Selecciona al menos un módulo')
  .max(3);

export async function create(req, res, next) {
  try {
    const parseResult = nombreSchema.safeParse(req.body?.nombre?.trim());
    if (!parseResult.success) {
      return res.status(400).json({ error: parseResult.error.errors[0].message });
    }
    const modulosResult = modulosSchema.safeParse(req.body?.modulos);
    if (!modulosResult.success) {
      return res.status(400).json({ error: modulosResult.error.errors[0].message });
    }
    const nombre = parseResult.data;
    const result = await categoriasService.upsert(nombre, null, modulosResult.data);
    invalidateCache('cache:/api/categorias*').catch(() => {});
    invalidateCache('cache:/api/v1/categorias*').catch(() => {});
    registrarAuditoria({
      accion: 'create_categoria', modulo: 'categorias', entidadId: nombre.trim(),
      descripcion: `Categoría creada: ${nombre.trim()} (${modulosResult.data.join(', ')})`,
      usuarioId: req.user?.id, usuarioEmail: req.user?.email, ip: req.ip,
    });
    res.status(201).json(result);
  } catch (err) { next(err); }
}

export async function updateModulos(req, res, next) {
  try {
    const nombre = decodeURIComponent(req.params.nombre);
    const modulosResult = modulosSchema.safeParse(req.body?.modulos);
    if (!modulosResult.success) {
      return res.status(400).json({ error: modulosResult.error.errors[0].message });
    }
    const result = await categoriasService.updateModulos(nombre, modulosResult.data);
    invalidateCache('cache:/api/categorias*').catch(() => {});
    invalidateCache('cache:/api/v1/categorias*').catch(() => {});
    invalidateCache('cache:/api/mapas*').catch(() => {});
    invalidateCache('cache:/api/documentos*').catch(() => {});
    invalidateCache('cache:/api/geovisores*').catch(() => {});
    registrarAuditoria({
      accion: 'update_categoria_modulos', modulo: 'categorias', entidadId: nombre,
      descripcion: `Módulos de "${nombre}" actualizados: ${modulosResult.data.join(', ')}`,
      usuarioId: req.user?.id, usuarioEmail: req.user?.email, ip: req.ip,
    });
    res.json(result);
  } catch (err) { next(err); }
}

export async function rename(req, res, next) {
  try {
    const nombreActual = decodeURIComponent(req.params.nombre);
    const parseResult = nombreSchema.safeParse(req.body?.nuevoNombre?.trim());
    if (!parseResult.success) {
      return res.status(400).json({ error: parseResult.error.errors[0].message });
    }
    const nuevoNombre = parseResult.data;
    const result = await categoriasService.rename(nombreActual, nuevoNombre);
    invalidateCache('cache:/api/categorias*').catch(() => {});
    invalidateCache('cache:/api/v1/categorias*').catch(() => {});
    invalidateCache('cache:/api/mapas*').catch(() => {});
    invalidateCache('cache:/api/documentos*').catch(() => {});
    invalidateCache('cache:/api/geovisores*').catch(() => {});
    registrarAuditoria({
      accion: 'rename_categoria', modulo: 'categorias', entidadId: nuevoNombre,
      descripcion: `Categoría renombrada: ${nombreActual} → ${nuevoNombre}`,
      usuarioId: req.user?.id, usuarioEmail: req.user?.email, ip: req.ip,
    });
    res.json(result);
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
