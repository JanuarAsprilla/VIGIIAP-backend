import { crearContexto } from './comun.js';
import { alcance } from './alcance.js';
import { fotosPublicas, PATRON_IMAGEN, PATRON_REFERENCIA } from './fotos.js';

/**
 * Foto representativa y total de fotos válidas de cada especie de la página, dentro del mismo alcance
 * territorial. Solo lee `fotos` y metadatos del registro (nunca coordenadas). Un registro asignado a
 * varios municipios cuenta una vez (DISTINCT ON). La representativa sale del registro con `anio` más reciente
 * y, a igualdad, menor `gbif_id`; los registros sin fotos válidas se saltan.
 * `fotos <> '[]'` descarta de entrada la gran mayoría de registros (sin foto) antes de evaluar los patrones.
 */
export async function fotosPorEspecie(client, lote, filtros, claves) {
  const fotosPorClave = new Map();
  if (claves.length === 0) return fotosPorClave;
  if (lote.metodo !== 'individual') return fotosAgregadas(client, claves);
  const ctx = crearContexto();
  const f = alcance(ctx, lote, filtros, ['con_foto']);
  const imagen = ctx.p(PATRON_IMAGEN);
  const referencia = ctx.p(PATRON_REFERENCIA);
  const donde = `${f.where} AND v.fotos <> '[]'::jsonb AND t.especie_clave = ANY(${ctx.p(claves)}::text[])`;
  const { rows } = await client.query(
    `WITH reg AS (
       SELECT DISTINCT ON (v.gbif_id) t.especie_clave, v.gbif_id, v.anio,
              (SELECT COALESCE(jsonb_agg(x.f ORDER BY x.o), '[]'::jsonb)
                 FROM jsonb_array_elements(CASE WHEN jsonb_typeof(v.fotos) = 'array' THEN v.fotos ELSE '[]'::jsonb END)
                      WITH ORDINALITY x(f, o)
                WHERE x.f->>'imagen' ~ ${imagen} AND x.f->>'referencia' ~ ${referencia}) AS validas
         ${f.desde} WHERE ${donde}
        ORDER BY v.gbif_id)
     SELECT especie_clave, sum(jsonb_array_length(validas))::int AS fotos_total,
            (array_agg(validas -> 0 ORDER BY anio DESC NULLS LAST, gbif_id ASC)
               FILTER (WHERE jsonb_array_length(validas) > 0))[1] AS foto
       FROM reg GROUP BY especie_clave`,
    ctx.params);
  for (const r of rows) fotosPorClave.set(r.especie_clave, { foto: fotosPublicas([r.foto])[0] ?? null, fotos_total: r.fotos_total });
  return fotosPorClave;
}

/**
 * Grupos agregados (sin registros individuales): la foto representativa de la especie sale de `especie_foto`,
 * cargada aparte por un proceso aislado. La API no consulta GBIF y la foto pasa por la misma validación de siempre.
 */
async function fotosAgregadas(client, claves) {
  const { rows } = await client.query(
    `SELECT especie_clave, imagen, autor, editor, licencia, referencia
       FROM biodiversidad.especie_foto WHERE especie_clave = ANY($1::text[])`, [claves]);
  const fotosPorClave = new Map();
  for (const r of rows) {
    const foto = fotosPublicas([r])[0] ?? null;
    if (foto) fotosPorClave.set(r.especie_clave, { foto, fotos_total: 1 });
  }
  return fotosPorClave;
}

export const SIN_FOTO = { foto: null, fotos_total: 0 };
