import { createMapaSchema, updateMapaSchema, toggleMapaSchema } from './mapas.schema.js';
import * as mapaService from './mapas.service.js';
import { registrarAuditoria } from '../../utils/auditLog.js';
import { registrarCustodia, ACCION } from '../../utils/dataCustody.js';

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
    registrarCustodia({
      tipoRecurso:  'mapa',
      recursoId:    mapa.id,
      accion:       ACCION.INGRESO,
      usuarioId:    req.user.id,
      usuarioEmail: req.user.email,
      ip:           req.ip,
      metadatos:    { titulo: mapa.titulo, categoria: mapa.categoria },
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
    registrarCustodia({
      tipoRecurso:  'mapa',
      recursoId:    mapa.id,
      accion:       ACCION.ACTUALIZACION,
      usuarioId:    req.user.id,
      usuarioEmail: req.user.email,
      ip:           req.ip,
      metadatos:    { titulo: mapa.titulo, campos: Object.keys(data) },
    });
    res.json(mapa);
  } catch (err) { next(err); }
}

export async function patchActivo(req, res, next) {
  try {
    const { activo } = toggleMapaSchema.parse(req.body);
    const mapa = await mapaService.setActivo(req.params.id, activo);
    registrarAuditoria({
      accion:       activo ? 'publish_mapa' : 'unpublish_mapa',
      modulo:       'mapas',
      entidadId:    mapa.id,
      descripcion:  `Mapa ${activo ? 'publicado' : 'despublicado'}: ${mapa.titulo}`,
      usuarioId:    req.user.id,
      usuarioEmail: req.user.email,
      ip:           req.ip,
    });
    registrarCustodia({
      tipoRecurso:  'mapa',
      recursoId:    mapa.id,
      accion:       activo ? ACCION.PUBLICACION : ACCION.DESPUBLICACION,
      usuarioId:    req.user.id,
      usuarioEmail: req.user.email,
      ip:           req.ip,
    });
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
    registrarCustodia({
      tipoRecurso:  'mapa',
      recursoId:    req.params.id,
      accion:       ACCION.ELIMINACION,
      usuarioId:    req.user.id,
      usuarioEmail: req.user.email,
      ip:           req.ip,
    });
    res.status(204).end();
  } catch (err) { next(err); }
}
