import {
  conLimite, loteActivo, exigirIndividual, crearContexto, fuente, condicionesTerritorio, condicionesEspecie,
  COLUMNAS_CONSERVACION,
} from './comun.js';
import { codigosGbif } from './marcas.js';
import { fotosPublicas, sqlTieneFoto, PATRON_IMAGEN, PATRON_REFERENCIA } from './fotos.js';

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

function condiciones(ctx, lote, filtros) {
  const f = fuente(lote, ctx);
  const donde = [f.condicionLote, ...condicionesTerritorio(ctx, filtros, f.codigo), ...condicionesEspecie(ctx, filtros)];
  if (filtros.anio_desde != null) donde.push(`v.anio >= ${ctx.p(filtros.anio_desde)}`);
  if (filtros.anio_hasta != null) donde.push(`v.anio <= ${ctx.p(filtros.anio_hasta)}`);
  if (filtros.con_foto) donde.push(sqlTieneFoto('v.fotos', ctx.p(PATRON_IMAGEN), ctx.p(PATRON_REFERENCIA)));
  return { desde: f.desde, where: donde.join(' AND ') };
}

/**
 * Registros individuales por la vista pública: las coordenadas de especies amenazadas (y todas,
 * si no hay un cruce de conservación activo) llegan ocultas desde la propia base de datos.
 */
export async function registros(filtros) {
  const { pagina, tamano } = filtros;
  return conLimite(async (client) => {
    const lote = await loteActivo(client, filtros.grupo);
    if (!lote) return null;
    exigirIndividual(lote);
    const ctx = crearContexto();
    const { desde, where } = condiciones(ctx, lote, filtros);
    const { rows: [{ n }] } = await client.query(`SELECT count(*)::int AS n ${desde} WHERE ${where}`, ctx.params);
    const { rows } = await client.query(
      `SELECT ${COLUMNAS_REGISTRO} ${desde} ${UNIR_CONJUNTO}
        WHERE ${where}
        ORDER BY v.gbif_id, a.codigo
        LIMIT ${ctx.p(tamano)} OFFSET ${ctx.p((pagina - 1) * tamano)}`,
      ctx.params);
    return {
      grupo: lote.grupo, desde: lote.desde, hasta: lote.hasta, pagina, tamano, total: n,
      registros: rows.map((r) => sinFotos(conFotos(r))),
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
