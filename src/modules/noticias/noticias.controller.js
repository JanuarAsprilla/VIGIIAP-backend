import { createNoticiaSchema, updateNoticiaSchema } from './noticias.schema.js';
import * as noticiaService from './noticias.service.js';

export async function index(req, res, next) {
  try { res.json(await noticiaService.getAll(req.query)); } catch (err) { next(err); }
}

export async function show(req, res, next) {
  try { res.json(await noticiaService.getBySlug(req.params.slug)); } catch (err) { next(err); }
}

export async function store(req, res, next) {
  try {
    // uploadSingle injects imagen_url into req.body if a file was uploaded
    const data = createNoticiaSchema.parse(req.body);
    res.status(201).json(await noticiaService.create(data, req.user.id));
  } catch (err) { next(err); }
}

export async function update(req, res, next) {
  try {
    // uploadSingle injects imagen_url into req.body if a file was uploaded
    const data = updateNoticiaSchema.parse(req.body);
    res.json(await noticiaService.update(req.params.id, data));
  } catch (err) { next(err); }
}

export async function destroy(req, res, next) {
  try { await noticiaService.remove(req.params.id); res.status(204).end(); }
  catch (err) { next(err); }
}
