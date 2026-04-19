import { createMapaSchema, updateMapaSchema, toggleMapaSchema } from './mapas.schema.js';
import * as mapaService from './mapas.service.js';
import { registrarAuditoria } from '../../utils/auditLog.js';

export async function index(req, res, next) {
  try {
    res.json(await mapaService.getAll(req.query, req.user));
  } catch (err) { next(err); }
}

export async function show(req, res, next) {
  try {
    res.json(await mapaService.getBySlug(req.params.slug, req.user));
  } catch (err) { next(err); }
}

export async function store(req, res, next) {
  try {
    const data = createMapaSchema.parse(req.body);
    const mapa = await mapaService.create(data, req.user.id);
    registrarAuditoria({
      accion:       'create_mapa',
      modulo:       'mapas',
      entidadId:    mapa.id,
      descripcion:  `Mapa creado: ${mapa.titulo}`,
      usuarioId:    req.user.id,
      usuarioEmail: req.user.email,
      ip:           req.ip,
    });
    res.status(201).json(mapa);
  } catch (err) { next(err); }
}

export async function update(req, res, next) {
  try {
    const data = updateMapaSchema.parse(req.body);
    const mapa = await mapaService.update(req.params.id, data);
    registrarAuditoria({
      accion:       'update_mapa',
      modulo:       'mapas',
      entidadId:    req.params.id,
      descripcion:  `Mapa actualizado: ${mapa.titulo}`,
      usuarioId:    req.user.id,
      usuarioEmail: req.user.email,
      ip:           req.ip,
    });
    res.json(mapa);
  } catch (err) { next(err); }
}

export async function patchActivo(req, res, next) {
  try {
    const { activo } = toggleMapaSchema.parse(req.body);
    const mapa = await mapaService.setActivo(req.params.id, activo);
    res.json(mapa);
  } catch (err) { next(err); }
}

export async function destroy(req, res, next) {
  try {
    await mapaService.remove(req.params.id);
    registrarAuditoria({
      accion:       'delete_mapa',
      modulo:       'mapas',
      entidadId:    req.params.id,
      descripcion:  `Mapa eliminado`,
      usuarioId:    req.user.id,
      usuarioEmail: req.user.email,
      ip:           req.ip,
    });
    res.status(204).end();
  } catch (err) { next(err); }
}
