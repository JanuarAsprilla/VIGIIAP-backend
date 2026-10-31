import {
  conLimite, loteActivo, crearContexto, condicionesTerritorio,
} from './comun.js';

const UNIR_MUNICIPIO = (alias) => `JOIN biodiversidad.municipio m ON m.territorio_huella = ${alias}.territorio_huella AND m.codigo = ${alias}.codigo`;

async function individuales(client, lote, filtros) {
  const ctx = crearContexto();
  const donde = [`v.lote_id = ${ctx.p(lote.id)}`, ...condicionesTerritorio(ctx, filtros, 'a.codigo')].join(' AND ');
  const desde = `FROM biodiversidad.vw_registro_publico v
    JOIN biodiversidad.asignacion a ON a.lote_id = v.lote_id AND a.gbif_id = v.gbif_id ${UNIR_MUNICIPIO('a')}
    WHERE ${donde}`;
  const { rows: por_anio } = await client.query(
    `SELECT v.anio, count(DISTINCT v.gbif_id)::int AS registros ${desde} AND v.anio IS NOT NULL GROUP BY v.anio ORDER BY v.anio`, ctx.params);
  const { rows: por_evidencia } = await client.query(
    `SELECT v.tipo_evidencia AS tipo, count(DISTINCT v.gbif_id)::int AS registros ${desde} AND v.tipo_evidencia IS NOT NULL
      GROUP BY v.tipo_evidencia ORDER BY registros DESC, tipo`, ctx.params);
  return { por_anio, por_evidencia };
}

async function agregados(client, lote, filtros) {
  const ctx = crearContexto();
  const idLote = ctx.p(lote.id);
  const territorio = condicionesTerritorio(ctx, filtros, 'f.codigo').map((c) => ` AND ${c}`).join('');
  const desde = (faceta) => `FROM biodiversidad.faceta_municipal f
    JOIN biodiversidad.resumen_territorial s ON s.lote_id = f.lote_id AND s.codigo = f.codigo ${UNIR_MUNICIPIO('s')}
    WHERE f.lote_id = ${idLote} AND f.faceta = '${faceta}'${territorio}`;
  const { rows: por_anio } = await client.query(
    `SELECT anio, sum(registros)::int AS registros
       FROM (SELECT CASE WHEN f.valor ~ '^[0-9]{4}$' THEN f.valor::int END AS anio, f.registros ${desde('anio')}) x
      WHERE anio IS NOT NULL GROUP BY anio ORDER BY anio`, ctx.params);
  const { rows: por_evidencia } = await client.query(
    `SELECT f.valor AS tipo, sum(f.registros)::int AS registros ${desde('tipo_evidencia')}
      GROUP BY f.valor ORDER BY registros DESC, tipo`, ctx.params);
  return { por_anio, por_evidencia };
}

export async function series(filtros) {
  return conLimite(async (client) => {
    const lote = await loteActivo(client, filtros.grupo);
    if (!lote) return null;
    const datos = lote.metodo === 'individual'
      ? await individuales(client, lote, filtros)
      : await agregados(client, lote, filtros);
    return { grupo: lote.grupo, metodo: lote.metodo, ...datos };
  });
}
