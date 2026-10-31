import { query } from '../../../config/database.js';
import { LOTE_ACTIVO } from './comun.js';

export const AVISO = 'Los conteos reflejan documentación disponible y esfuerzo de muestreo, no abundancia ni inventarios '
  + 'completos. Valide datos, coordenadas, identificaciones, fechas, licencias y categorías de conservación en las fuentes '
  + 'originales antes de usarlos. Las coordenadas de especies amenazadas se ocultan.';

export async function estado() {
  const { rows: grupos } = await query(
    `SELECT grupo, metodo, desde, hasta, registros::int AS registros, fecha_fuente, doi
       FROM biodiversidad.lote WHERE ${LOTE_ACTIVO} ORDER BY grupo`);
  const { rows: [cruce] } = await query(
    `SELECT creado_en FROM biodiversidad.conservacion_importacion WHERE activo`);
  return {
    grupos,
    conservacion: { activa: Boolean(cruce), actualizada_en: cruce?.creado_en ?? null },
    aviso: AVISO,
  };
}
