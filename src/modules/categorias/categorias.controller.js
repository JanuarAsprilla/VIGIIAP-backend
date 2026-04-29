import * as categoriasService from './categorias.service.js';

export async function index(req, res, next) {
  try {
    res.json(await categoriasService.getAll());
  } catch (err) { next(err); }
}

export async function upsertThumbnail(req, res, next) {
  try {
    const nombre = decodeURIComponent(req.params.nombre);
    const thumbnailUrl = req.body.thumbnail_url ?? null;
    res.json(await categoriasService.updateThumbnail(nombre, thumbnailUrl));
  } catch (err) { next(err); }
}

export async function create(req, res, next) {
  try {
    const { nombre } = req.body;
    if (!nombre?.trim()) {
      return res.status(400).json({ error: 'El nombre de la categoría es obligatorio' });
    }
    res.status(201).json(await categoriasService.upsert(nombre.trim()));
  } catch (err) { next(err); }
}

export async function destroy(req, res, next) {
  try {
    await categoriasService.remove(decodeURIComponent(req.params.nombre));
    res.json({ ok: true });
  } catch (err) { next(err); }
}
