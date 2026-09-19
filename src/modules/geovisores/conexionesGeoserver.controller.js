import { createConexionGeoserverSchema, updateConexionGeoserverSchema } from './geovisores.schema.js';
import * as conexionService from './conexionesGeoserver.service.js';
import { listarWorkspacesDeConexion } from './geovisores.service.js';
import { esGeometriaValida } from '../../utils/geometry.js';
import { registrarAuditoria } from '../../utils/auditLog.js';

export async function index(req, res, next) {
  try {
    res.json(await conexionService.getAll());
  } catch (err) { next(err); }
}

export async function show(req, res, next) {
  try {
    res.json(await conexionService.getById(req.params.id));
  } catch (err) { next(err); }
}

export async function store(req, res, next) {
  try {
    const data = createConexionGeoserverSchema.parse(req.body);
    const conexion = await conexionService.create(data);
    registrarAuditoria({
      accion: 'create_conexion_geoserver',
      modulo: 'geovisores',
      entidadId: conexion.id,
      descripcion: `Conexión GeoServer creada: ${conexion.nombre}`,
      usuarioId: req.user.id,
      usuarioEmail: req.user.email,
      ip: req.ip,
    });
    res.status(201).json(conexion);
  } catch (err) { next(err); }
}

export async function update(req, res, next) {
  try {
    const data = updateConexionGeoserverSchema.parse(req.body);
    const conexion = await conexionService.update(req.params.id, data);
    registrarAuditoria({
      accion: 'update_conexion_geoserver',
      modulo: 'geovisores',
      entidadId: conexion.id,
      // Nunca se registra la contraseña en el log de auditoría, ni siquiera cifrada.
      descripcion: `Conexión GeoServer actualizada: ${conexion.nombre}`,
      usuarioId: req.user.id,
      usuarioEmail: req.user.email,
      ip: req.ip,
    });
    res.json(conexion);
  } catch (err) { next(err); }
}

/** GET /admin/conexiones-geoserver/:id/workspaces — descubre en vivo qué workspaces
 *  publica esta conexión, para el selector del constructor de geovisores. */
export async function workspaces(req, res, next) {
  try {
    res.json(await listarWorkspacesDeConexion(req.params.id));
  } catch (err) { next(err); }
}

/** GET /admin/conexiones-geoserver/:id/wms — vista previa en vivo mientras se
 *  construye un geovisor (todavía sin slug). Mismo parseo por cadena cruda que
 *  geovisores.controller.js#wms — ver ese comentario para el porqué. */
export async function wmsPreview(req, res, next) {
  try {
    const queryCruda = new URLSearchParams(req.originalUrl.split('?')[1] ?? '');
    let geometriaFiltro;
    const geometriaRaw = queryCruda.get('geometria');
    if (geometriaRaw) {
      const parseada = JSON.parse(geometriaRaw);
      if (!esGeometriaValida(parseada)) {
        return res.status(400).json({ error: 'Geometría de filtro inválida' });
      }
      geometriaFiltro = parseada;
    }
    queryCruda.delete('geometria');
    const respuesta = await conexionService.proxyWmsDeConexion(req.params.id, queryCruda, geometriaFiltro);
    res.status(respuesta.status);
    res.set('Content-Type', respuesta.headers.get('content-type') ?? 'image/png');
    res.send(Buffer.from(await respuesta.arrayBuffer()));
  } catch (err) { next(err); }
}

/** GET /admin/conexiones-geoserver/:id/leyenda/:capaId — leyenda para la vista previa en vivo. */
export async function leyendaPreview(req, res, next) {
  try {
    const respuesta = await conexionService.proxyLeyendaDeConexion(req.params.id, req.params.capaId);
    res.status(respuesta.status);
    res.set('Content-Type', respuesta.headers.get('content-type') ?? 'image/png');
    res.send(Buffer.from(await respuesta.arrayBuffer()));
  } catch (err) { next(err); }
}

export async function destroy(req, res, next) {
  try {
    await conexionService.remove(req.params.id);
    registrarAuditoria({
      accion: 'delete_conexion_geoserver',
      modulo: 'geovisores',
      entidadId: req.params.id,
      descripcion: 'Conexión GeoServer eliminada',
      usuarioId: req.user.id,
      usuarioEmail: req.user.email,
      ip: req.ip,
    });
    res.status(204).send();
  } catch (err) { next(err); }
}
