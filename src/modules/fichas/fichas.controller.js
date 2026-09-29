import { configFichasSchema, fichaPuntoSchema } from './fichas.schema.js';
import * as fichasService from './fichas.service.js';
import { registrarAuditoria } from '../../utils/auditLog.js';

/** GET /admin/conexiones-geoserver/:id/capas/:capaId/atributos */
export async function atributosCapa(req, res, next) {
  try {
    res.json(await fichasService.listarAtributos(req.params.id, req.params.capaId));
  } catch (err) { next(err); }
}

export async function obtenerConfig(req, res, next) {
  try {
    const { conexionId, capaId } = req.query;
    if (!conexionId || typeof conexionId !== 'string' || !capaId || typeof capaId !== 'string') {
      return res.status(400).json({ error: 'Faltan los parámetros conexionId y/o capaId' });
    }
    const config = await fichasService.obtenerConfig(conexionId, capaId);
    if (!config) return res.status(404).json({ error: 'No hay configuración de fichas para esta capa' });
    res.json(config);
  } catch (err) { next(err); }
}

export async function upsertConfig(req, res, next) {
  try {
    const data = configFichasSchema.parse(req.body);
    const config = await fichasService.upsertConfig(data, req.user.id);
    registrarAuditoria({
      accion: 'upsert_config_fichas',
      modulo: 'geovisores',
      entidadId: config.id,
      descripcion: `Config de fichas guardada para la capa ${config.capaId}`,
      usuarioId: req.user.id,
      usuarioEmail: req.user.email,
      ip: req.ip,
    });
    res.json(config);
  } catch (err) { next(err); }
}

export async function obtenerFicha(req, res, next) {
  try {
    res.json(await fichasService.obtenerFicha(req.params.configId, req.params.valor));
  } catch (err) { next(err); }
}

export async function upsertFicha(req, res, next) {
  try {
    const data = fichaPuntoSchema.parse(req.body);
    const ficha = await fichasService.upsertFicha(req.params.configId, req.params.valor, data, req.user.id);
    registrarAuditoria({
      accion: 'upsert_ficha_punto',
      modulo: 'geovisores',
      entidadId: ficha.id,
      descripcion: `Ficha guardada: ${ficha.valorIdentificador}`,
      usuarioId: req.user.id,
      usuarioEmail: req.user.email,
      ip: req.ip,
    });
    res.json(ficha);
  } catch (err) { next(err); }
}

export async function eliminarFicha(req, res, next) {
  try {
    await fichasService.eliminarFicha(req.params.configId, req.params.valor);
    registrarAuditoria({
      accion: 'delete_ficha_punto',
      modulo: 'geovisores',
      entidadId: req.params.configId,
      descripcion: `Ficha eliminada: ${req.params.valor}`,
      usuarioId: req.user.id,
      usuarioEmail: req.user.email,
      ip: req.ip,
    });
    res.status(204).send();
  } catch (err) { next(err); }
}

export async function features(req, res, next) {
  try {
    res.json(await fichasService.listarFeaturesConCompletitud(req.params.configId));
  } catch (err) { next(err); }
}
