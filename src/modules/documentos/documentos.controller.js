import { createDocumentoSchema, updateDocumentoSchema } from './documentos.schema.js';
import * as docService from './documentos.service.js';

export async function index(req, res, next) {
  try { res.json(await docService.getAll(req.query)); } catch (err) { next(err); }
}

export async function show(req, res, next) {
  try { res.json(await docService.getBySlug(req.params.slug)); } catch (err) { next(err); }
}

export async function store(req, res, next) {
  try {
    const data = createDocumentoSchema.parse(req.body);
    res.status(201).json(await docService.create(data, req.user.id));
  } catch (err) { next(err); }
}

export async function update(req, res, next) {
  try {
    const data = updateDocumentoSchema.parse(req.body);
    res.json(await docService.update(req.params.id, data));
  } catch (err) { next(err); }
}

export async function destroy(req, res, next) {
  try { await docService.remove(req.params.id); res.status(204).end(); }
  catch (err) { next(err); }
}
