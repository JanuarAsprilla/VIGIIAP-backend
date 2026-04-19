import { createNoticiaSchema, updateNoticiaSchema } from './noticias.schema.js';
import * as noticiaService from './noticias.service.js';
import { registrarAuditoria } from '../../utils/auditLog.js';

export async function index(req, res, next) {
  try { res.json(await noticiaService.getAll(req.query, req.user)); } catch (err) { next(err); }
}

export async function show(req, res, next) {
  try { res.json(await noticiaService.getBySlug(req.params.slug, req.user)); } catch (err) { next(err); }
}

export async function store(req, res, next) {
  try {
    const data    = createNoticiaSchema.parse(req.body);
    const noticia = await noticiaService.create(data, req.user.id);
    registrarAuditoria({
      accion:       'create_noticia',
      modulo:       'noticias',
      entidadId:    noticia.id,
      descripcion:  `Noticia creada: ${noticia.titulo}`,
      usuarioId:    req.user.id,
      usuarioEmail: req.user.email,
      ip:           req.ip,
    });
    res.status(201).json(noticia);
  } catch (err) { next(err); }
}

export async function update(req, res, next) {
  try {
    const data    = updateNoticiaSchema.parse(req.body);
    const noticia = await noticiaService.update(req.params.id, data);
    registrarAuditoria({
      accion:       'update_noticia',
      modulo:       'noticias',
      entidadId:    req.params.id,
      descripcion:  `Noticia actualizada: ${noticia.titulo}`,
      usuarioId:    req.user.id,
      usuarioEmail: req.user.email,
      ip:           req.ip,
    });
    res.json(noticia);
  } catch (err) { next(err); }
}

export async function destroy(req, res, next) {
  try {
    await noticiaService.remove(req.params.id);
    registrarAuditoria({
      accion:       'delete_noticia',
      modulo:       'noticias',
      entidadId:    req.params.id,
      descripcion:  `Noticia eliminada`,
      usuarioId:    req.user.id,
      usuarioEmail: req.user.email,
      ip:           req.ip,
    });
    res.status(204).end();
  } catch (err) { next(err); }
}
