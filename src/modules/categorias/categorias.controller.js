import * as categoriasService from './categorias.service.js';
import { registrarAuditoria } from '../../utils/auditLog.js';

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
    registrarAuditoria({
      accion: 'update_categoria_thumbnail', modulo: 'categorias', entidadId: nombre,
      descripcion: `Thumbnail actualizado para categoría: ${nombre}`,
      usuarioId: req.user?.id, usuarioEmail: req.user?.email, ip: req.ip,
    });
    res.json(result);
  } catch (err) { next(err); }
}

export async function create(req, res, next) {
  try {
    const { nombre } = req.body;
    if (!nombre?.trim()) {
      return res.status(400).json({ error: 'El nombre de la categoría es obligatorio' });
    }
    const result = await categoriasService.upsert(nombre.trim());
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
    registrarAuditoria({
      accion: 'delete_categoria', modulo: 'categorias', entidadId: nombre,
      descripcion: `Categoría eliminada (soft): ${nombre}`,
      usuarioId: req.user?.id, usuarioEmail: req.user?.email, ip: req.ip,
    });
    res.json({ ok: true });
  } catch (err) { next(err); }
}
