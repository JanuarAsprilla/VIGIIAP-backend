import { createConexionGeoserverSchema, updateConexionGeoserverSchema } from './geovisores.schema.js';
import * as conexionService from './conexionesGeoserver.service.js';
import { listarWorkspacesDeConexion } from './geovisores.service.js';
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

/** Workspaces publicados en esta conexión -- para elegir `workspacesGeoserver` al crear/editar un geovisor. */
export async function workspaces(req, res, next) {
  try {
    res.json(await listarWorkspacesDeConexion(req.params.id));
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
