import * as servicio from './biodiversidad.service.js';
import {
  municipiosQuerySchema, registrosQuerySchema, resumenQuerySchema, especiesQuerySchema, seriesQuerySchema,
  detalleQuerySchema, registroParamsSchema, puntosQuerySchema, opcionesQuerySchema,
} from './biodiversidad.schema.js';
import { ConsultaInvalida } from './biodiversidad.errores.js';
import { idVisible, idRealDesdeUrl } from './consultas/idOpaco.js';

const SIN_DATOS = { error: 'No hay datos cargados para ese grupo' };
const SIN_REGISTRO = { error: 'Registro no encontrado' };

function responderError(err, res, next) {
  if (err instanceof ConsultaInvalida) return res.status(err.status).json({ error: err.message });
  // 57014 = tiempo límite de la consulta; no se expone el detalle de la BD.
  if (err?.code === '57014') {
    return res.status(503).json({ error: 'La consulta tardó demasiado. Acota los filtros e inténtalo de nuevo.' });
  }
  return next(err);
}

/** Valida la consulta, ejecuta la función del servicio y responde 404 si el grupo no tiene datos. */
function consulta(esquema, ejecutar, sinResultado = SIN_DATOS) {
  return async (req, res, next) => {
    try {
      const resultado = await ejecutar(esquema.parse(req.query), req);
      if (!resultado) return res.status(404).json(sinResultado);
      return res.json(resultado);
    } catch (err) { return responderError(err, res, next); }
  };
}

export async function estado(_req, res, next) {
  try {
    res.json(await servicio.estado());
  } catch (err) { responderError(err, res, next); }
}

export const municipios = consulta(municipiosQuerySchema, (filtros) => servicio.municipios(filtros));
/**
 * El gbif_id de un registro con la ubicación reservada no sale de la API (con él se recupera la coordenada en
 * api.gbif.org si el conjunto no la generalizó): se entrega un id opaco que solo este servidor resuelve.
 */
const conIdProtegido = (r) => ({ ...r, gbif_id: idVisible(r.gbif_id, r.coordenadas_ocultas) });

export const registros = consulta(registrosQuerySchema, async (filtros) => {
  const r = await servicio.registros(filtros);
  return r && { ...r, registros: r.registros?.map(conIdProtegido) };
});
export const resumen = consulta(resumenQuerySchema, (filtros) => servicio.resumen(filtros));
export const especies = consulta(especiesQuerySchema, (filtros) => servicio.especies(filtros));
export const series = consulta(seriesQuerySchema, (filtros) => servicio.series(filtros));
export const puntos = consulta(puntosQuerySchema, (filtros) => servicio.puntos(filtros));
export const opciones = consulta(opcionesQuerySchema, (filtros) => servicio.opciones(filtros));
export const registro = consulta(
  detalleQuerySchema,
  async ({ grupo }, req) => {
    const gbifId = idRealDesdeUrl(registroParamsSchema.parse(req.params).gbif_id);
    const r = gbifId === null ? null : await servicio.registro(gbifId, grupo);
    return r && conIdProtegido(r);
  },
  SIN_REGISTRO,
);
