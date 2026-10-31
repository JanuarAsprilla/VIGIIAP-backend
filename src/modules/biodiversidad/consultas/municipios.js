import { conLimite, loteActivo, crearContexto, condicionesTerritorio } from './comun.js';
import { alcance } from './alcance.js';
import { hayFiltros, hayFiltrosEspecie } from './filtros.js';
import { validarInventario, usaFuente } from './reglas_inventario.js';

const ESPECIES_INDIVIDUALES = `
  SELECT a.codigo, count(DISTINCT v.especie_clave)::int AS especies
    FROM biodiversidad.vw_registro_publico v
    JOIN biodiversidad.asignacion a ON a.lote_id = v.lote_id AND a.gbif_id = v.gbif_id
   WHERE v.lote_id = $1 AND v.especie_clave IS NOT NULL
   GROUP BY a.codigo`;

const ESPECIES_AGREGADAS = `
  SELECT ie.codigo, count(DISTINCT t.especie_clave)::int AS especies
    FROM biodiversidad.inventario_especie ie
    JOIN biodiversidad.taxon_version t ON t.huella = ie.taxon_huella
   WHERE ie.lote_id = $1 AND t.especie_clave IS NOT NULL
   GROUP BY ie.codigo`;

const COLUMNAS = `s.codigo AS codigo_municipal, m.nombre AS municipio, m.departamento`;
const DESDE_MUNICIPIOS = `
  FROM biodiversidad.resumen_territorial s
  JOIN biodiversidad.municipio m ON m.territorio_huella = s.territorio_huella AND m.codigo = s.codigo`;

/** Sin filtros: los totales precalculados del corte (camino rápido, idéntico a la v2). */
async function sinFiltros(client, lote) {
  const { rows } = await client.query(
    `SELECT ${COLUMNAS}, s.registros::int AS registros, s.sin_especie::int AS sin_especie
       ${DESDE_MUNICIPIOS} WHERE s.lote_id = $1 ORDER BY m.departamento, m.nombre`, [lote.id]);
  const { rows: conteos } = await client.query(lote.metodo === 'individual' ? ESPECIES_INDIVIDUALES : ESPECIES_AGREGADAS, [lote.id]);
  const especiesPor = new Map(conteos.map((c) => [c.codigo, c.especies]));
  return rows.map((r) => ({ ...r, especies: especiesPor.get(r.codigo_municipal) ?? 0 }));
}

/** Conteos del subconjunto por municipio; los municipios sin coincidencias salen con 0. */
function conFiltros(client, lote, filtros, subconsulta, ctx) {
  const territorio = condicionesTerritorio(ctx, filtros, 's.codigo').join(' AND ');
  return client.query(
    `SELECT ${COLUMNAS}, ${subconsulta.columnas}
       ${DESDE_MUNICIPIOS}
       LEFT JOIN (${subconsulta.sql}) c ON c.codigo = s.codigo
      WHERE s.lote_id = ${ctx.p(lote.id)}${territorio ? ` AND ${territorio}` : ''}
      ORDER BY m.departamento, m.nombre`, ctx.params);
}

function porRegistros(lote, filtros, ctx) {
  const { desde, where, codigo } = alcance(ctx, lote, filtros);
  const individual = lote.metodo === 'individual';
  const registros = individual ? 'count(*)' : 'sum(ie.registros)';
  const sinEspecie = individual ? `count(*) FILTER (WHERE t.especie_clave IS NULL)` : `sum(ie.registros) FILTER (WHERE t.especie_clave IS NULL)`;
  return {
    columnas: `COALESCE(c.registros, 0)::int AS registros, COALESCE(c.sin_especie, 0)::int AS sin_especie, COALESCE(c.especies, 0)::int AS especies`,
    sql: `SELECT ${codigo} AS codigo, ${registros} AS registros, ${sinEspecie} AS sin_especie, count(DISTINCT t.especie_clave) AS especies
            ${desde} WHERE ${where} GROUP BY ${codigo}`,
  };
}

/** Entidad/conjunto en agregados: solo se conocen los registros por fuente (no hay especies ni sin_especie). */
function porFuente(lote, filtros, ctx) {
  const donde = [`cf.lote_id = ${ctx.p(lote.id)}`];
  if (filtros.dataset_key != null) donde.push(`cf.dataset_key = ${ctx.p(filtros.dataset_key)}`);
  if (filtros.entidad_clave != null) {
    donde.push(`cf.dataset_key IN (SELECT clave FROM biodiversidad.conjunto WHERE entidad_clave = ${ctx.p(filtros.entidad_clave)})`);
  }
  return {
    columnas: `COALESCE(c.registros, 0)::int AS registros, NULL::int AS sin_especie, NULL::int AS especies`,
    sql: `SELECT cf.codigo, sum(cf.registros) AS registros FROM biodiversidad.conteo_fuente cf WHERE ${donde.join(' AND ')} GROUP BY cf.codigo`,
  };
}

export async function municipios(filtros) {
  return conLimite(async (client) => {
    const lote = await loteActivo(client, filtros.grupo);
    if (!lote) return null;
    if (lote.metodo !== 'individual') validarInventario(filtros, { fuente: true });
    let municipiosLista;
    if (!hayFiltros(filtros)) {
      municipiosLista = await sinFiltros(client, lote);
    } else {
      const ctx = crearContexto();
      const porFuenteSola = lote.metodo !== 'individual' && usaFuente(filtros) && !hayFiltrosEspecie(filtros);
      const sub = porFuenteSola ? porFuente(lote, filtros, ctx) : porRegistros(lote, filtros, ctx);
      municipiosLista = (await conFiltros(client, lote, filtros, sub, ctx)).rows;
    }
    return { grupo: lote.grupo, metodo: lote.metodo, desde: lote.desde, hasta: lote.hasta, municipios: municipiosLista };
  });
}
