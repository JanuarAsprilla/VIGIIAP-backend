import {
  conLimite, loteActivo, exigirIndividual, crearContexto,
} from './comun.js';
import { alcance } from './alcance.js';
import { UBICACION_PUBLICA } from './filtros.js';

const NOMBRE_AMENAZA = { 1: 'CR', 2: 'EN', 3: 'VU' };

/**
 * Registros únicos del alcance (uno asignado a dos municipios cuenta una vez). La fuente es SIEMPRE la
 * vista pública: las coordenadas reservadas llegan nulas desde la base y además se excluyen por marca.
 */
function registrosDelAlcance(lote, filtros, ctx) {
  const { desde, where } = alcance(ctx, lote, filtros);
  return `SELECT DISTINCT ON (v.gbif_id) v.gbif_id, v.latitud, v.longitud, v.coordenadas_ocultas,
                 (${UBICACION_PUBLICA}) AS publica, t.especie, t.especie_clave, ec.amenaza_orden
            ${desde} WHERE ${where} ORDER BY v.gbif_id`;
}

function condicionCaja(ctx, bbox) {
  if (!bbox) return '';
  const [minLon, minLat, maxLon, maxLat] = bbox;
  return ` AND longitud BETWEEN ${ctx.p(minLon)}::float8 AND ${ctx.p(maxLon)}::float8 AND latitud BETWEEN ${ctx.p(minLat)}::float8 AND ${ctx.p(maxLat)}::float8`;
}

const aPunto = (r) => ({
  id: r.gbif_id, lat: r.latitud, lon: r.longitud, e: r.especie ?? null, ek: r.especie_clave ?? null,
  a: NOMBRE_AMENAZA[r.amenaza_orden] ?? null,
});

/**
 * Ubicaciones PÚBLICAS de los registros filtrados para dibujarlas en el mapa. Las reservadas no se devuelven:
 * solo se cuentan (`ocultos`, sin tener en cuenta la caja). Si hay más que `limite`, la muestra es determinista.
 */
export async function puntos(filtros) {
  const { limite, bbox } = filtros;
  return conLimite(async (client) => {
    const lote = await loteActivo(client, filtros.grupo);
    if (!lote) return null;
    exigirIndividual(lote);
    const ctx = crearContexto();
    const base = registrosDelAlcance(lote, filtros, ctx);
    const caja = `publica${condicionCaja(ctx, bbox)}`;
    const { rows: [{ total, ocultos }] } = await client.query(
      `WITH b AS (${base})
       SELECT count(*) FILTER (WHERE ${caja})::int AS total, count(*) FILTER (WHERE coordenadas_ocultas)::int AS ocultos FROM b`, ctx.params);
    const { rows } = await client.query(
      `WITH b AS (${base})
       SELECT gbif_id, latitud, longitud, especie, especie_clave, amenaza_orden FROM b
        WHERE ${caja} ORDER BY md5(gbif_id), gbif_id LIMIT ${ctx.p(limite)}`, ctx.params);
    return {
      grupo: lote.grupo, total, mostrados: rows.length, ocultos, muestreado: total > limite, puntos: rows.map(aPunto),
    };
  });
}
