import * as servicio from './biodiversidad.service.js';
import { municipiosQuerySchema, registrosQuerySchema } from './biodiversidad.schema.js';
import { ConsultaInvalida } from './biodiversidad.errores.js';

const SIN_DATOS = { error: 'No hay datos cargados para ese grupo' };

function responderError(err, res, next) {
  if (err instanceof ConsultaInvalida) return res.status(err.status).json({ error: err.message });
  // 57014 = tiempo límite de la consulta; no se expone el detalle de la BD.
  if (err?.code === '57014') {
    return res.status(503).json({ error: 'La consulta tardó demasiado. Acota los filtros e inténtalo de nuevo.' });
  }
  return next(err);
}

export async function estado(_req, res, next) {
  try {
    res.json(await servicio.estado());
  } catch (err) { responderError(err, res, next); }
}

export async function municipios(req, res, next) {
  try {
    const { grupo } = municipiosQuerySchema.parse(req.query);
    const resultado = await servicio.municipios(grupo);
    if (!resultado) return res.status(404).json(SIN_DATOS);
    res.json(resultado);
  } catch (err) { responderError(err, res, next); }
}

export async function registros(req, res, next) {
  try {
    const filtros = registrosQuerySchema.parse(req.query);
    const resultado = await servicio.registros(filtros);
    if (!resultado) return res.status(404).json(SIN_DATOS);
    res.json(resultado);
  } catch (err) { responderError(err, res, next); }
}
