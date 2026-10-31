import {
  conLimite, loteActivo, exigirIndividual, crearContexto, fuente, COLUMNAS_CONSERVACION,
} from './comun.js';
import { alcance } from './alcance.js';
import { codigosGbif } from './marcas.js';
import { fotosPublicas } from './fotos.js';

const COLUMNAS_REGISTRO = `
  v.gbif_id, v.especie, v.especie_clave, v.anio, v.fecha_evento, v.tipo_evidencia, v.licencia,
  v.latitud, v.longitud, v.incertidumbre_m, v.coordenadas_ocultas,
  c.titulo AS conjunto, c.doi AS doi_conjunto, a.codigo AS codigo_municipal, m.nombre AS municipio, m.departamento,
  v.registrado_por, v.identificado_por, v.fotos, ${COLUMNAS_CONSERVACION}`;

const COLUMNAS_DETALLE = `, v.marcas_revision, v.marcas_gbif, v.institution_code, v.collection_code, v.catalog_number,
  v.occurrence_id, v.nombre_original, t.reino, t.clase, t.orden, t.familia, t.genero`;

const UNIR_CONJUNTO = 'JOIN biodiversidad.conjunto c ON c.clave = v.dataset_key';

/** Primera foto válida y total de válidas: las inválidas se descartan en el servidor. */
function conFotos({ fotos, ...resto }) {
  const validas = fotosPublicas(fotos);
  return { ...resto, foto: validas[0] ?? null, fotos_total: validas.length, _fotos: validas };
}

const sinFotos = ({ _fotos, ...resto }) => resto;

// Orden estable: el desempate final por gbif_id evita repetir o perder filas al paginar.
const ORDENES = {
  anio_desc: 'anio DESC NULLS LAST, gbif_id',
  anio_asc: 'anio ASC NULLS LAST, gbif_id',
  especie: 'especie ASC NULLS LAST, anio DESC NULLS LAST, gbif_id',
};

/**
 * Registros individuales por la vista pública: las coordenadas de especies amenazadas (y todas,
 * si no hay un cruce de conservación activo) llegan ocultas desde la propia base de datos.
 */
export async function registros(filtros) {
  const { pagina, tamano, orden = 'anio_desc' } = filtros;
  return conLimite(async (client) => {
    const lote = await loteActivo(client, filtros.grupo);
    if (!lote) return null;
    exigirIndividual(lote);
    const ctx = crearContexto();
    const { desde, where } = alcance(ctx, lote, filtros);
    const { rows: [{ n }] } = await client.query(`SELECT count(DISTINCT v.gbif_id)::int AS n ${desde} WHERE ${where}`, ctx.params);
    const { rows } = await client.query(
      // Un registro en varios municipios aparece una vez (con el primer municipio que cumple el alcance).
      `SELECT * FROM (
         SELECT ${COLUMNAS_REGISTRO}, row_number() OVER (PARTITION BY v.gbif_id ORDER BY a.codigo) AS _n
           ${desde} ${UNIR_CONJUNTO} WHERE ${where}) x
        WHERE _n = 1
        ORDER BY ${ORDENES[orden]}
        LIMIT ${ctx.p(tamano)} OFFSET ${ctx.p((pagina - 1) * tamano)}`,
      ctx.params);
    return {
      grupo: lote.grupo, desde: lote.desde, hasta: lote.hasta, pagina, tamano, total: n,
      registros: rows.map(({ _n, ...r }) => sinFotos(conFotos(r))),
    };
  });
}

const marcas = (texto) => (texto ?? '').split(';').map((m) => m.trim()).filter(Boolean);

/** Un registro con todo su detalle; si está en varios municipios, el primero por código. */
export async function registro(gbifId, grupo) {
  return conLimite(async (client) => {
    const lote = await loteActivo(client, grupo);
    if (!lote) return null;
    exigirIndividual(lote);
    const ctx = crearContexto();
    const { desde, condicionLote } = fuente(lote, ctx);
    const { rows: [fila] } = await client.query(
      `SELECT ${COLUMNAS_REGISTRO} ${COLUMNAS_DETALLE} ${desde} ${UNIR_CONJUNTO}
        WHERE ${condicionLote} AND v.gbif_id = ${ctx.p(gbifId)}
        ORDER BY a.codigo LIMIT 1`,
      ctx.params);
    if (!fila) return null;
    const {
      marcas_revision, marcas_gbif, reino, clase, orden, familia, genero, _fotos, ...resto
    } = conFotos(fila);
    return { ...resto, fotos: _fotos, marcas_revision: marcas(marcas_revision), marcas_gbif: codigosGbif(marcas_gbif), taxonomia: { reino, clase, orden, familia, genero } };
  });
}
