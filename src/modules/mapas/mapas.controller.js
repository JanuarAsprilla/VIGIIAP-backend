import { createMapaSchema, updateMapaSchema } from './mapas.schema.js';
import * as mapaService from './mapas.service.js';

export async function index(req, res, next) {
  try {
    res.json(await mapaService.getAll(req.query));
  } catch (err) { next(err); }
}

export async function show(req, res, next) {
  try {
    res.json(await mapaService.getBySlug(req.params.slug));
  } catch (err) { next(err); }
}

export async function store(req, res, next) {
  try {
    const data = createMapaSchema.parse(req.body);
    const mapa = await mapaService.create(data, req.user.id);
    res.status(201).json(mapa);
  } catch (err) { next(err); }
}

export async function update(req, res, next) {
  try {
    const data = updateMapaSchema.parse(req.body);
    res.json(await mapaService.update(req.params.id, data));
  } catch (err) { next(err); }
}

export async function destroy(req, res, next) {
  try {
    await mapaService.remove(req.params.id);
    res.status(204).end();
  } catch (err) { next(err); }
}
