import * as noticiaService from './noticias.service.js';

export async function index(req, res, next) {
  try { res.json(await noticiaService.getAll(req.query)); } catch (err) { next(err); }
}

export async function show(req, res, next) {
  try { res.json(await noticiaService.getBySlug(req.params.slug)); } catch (err) { next(err); }
}

export async function store(req, res, next) {
  try {
    res.status(201).json(await noticiaService.create(req.body, req.user.id));
  } catch (err) { next(err); }
}

export async function update(req, res, next) {
  try { res.json(await noticiaService.update(req.params.id, req.body)); }
  catch (err) { next(err); }
}

export async function destroy(req, res, next) {
  try { await noticiaService.remove(req.params.id); res.status(204).end(); }
  catch (err) { next(err); }
}
