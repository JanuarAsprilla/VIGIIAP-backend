import {
  conLimite, loteActivo, crearContexto, fuente, condicionesTerritorio,
} from './comun.js';
import { sqlTieneFoto, PATRON_IMAGEN, PATRON_REFERENCIA } from './fotos.js';

const ANIO_VALIDO = `'^[0-9]{4}$'`;

async function conteosEspecies(client, lote, filtros) {
  const ctx = crearContexto();
  const f = fuente(lote, ctx);
  const donde = [f.condicionLote, 't.especie_clave IS NOT NULL', ...condicionesTerritorio(ctx, filtros, f.codigo)].join(' AND ');
  const { rows: [r] } = await client.query(
    `WITH sp AS (SELECT DISTINCT t.clasificacion_clave, t.especie_clave ${f.desde} WHERE ${donde})
     SELECT count(*)::int AS especies,
            count(*) FILTER (WHERE ec.amenaza_orden = 1)::int AS cr,
            count(*) FILTER (WHERE ec.amenaza_orden = 2)::int AS en,
            count(*) FILTER (WHERE ec.amenaza_orden = 3)::int AS vu,
            count(*) FILTER (WHERE ec.endemica_colombia)::int AS endemicas_colombia,
            count(*) FILTER (WHERE ec.endemica_choco)::int AS endemicas_choco,
            count(*) FILTER (WHERE ec.introducida)::int AS introducidas,
            count(*) FILTER (WHERE ec.invasora)::int AS invasoras
       FROM sp
       LEFT JOIN biodiversidad.vw_especie_conservacion ec
              ON ec.clasificacion_clave = sp.clasificacion_clave AND ec.especie_clave = sp.especie_clave`,
    ctx.params);
  return r;
}

async function totalesIndividuales(client, lote, filtros) {
  const ctx = crearContexto();
  const f = fuente(lote, ctx);
  const donde = [f.condicionLote, ...condicionesTerritorio(ctx, filtros, f.codigo)].join(' AND ');
  const tieneFoto = sqlTieneFoto('v.fotos', ctx.p(PATRON_IMAGEN), ctx.p(PATRON_REFERENCIA));
  const { rows: [r] } = await client.query(
    `SELECT count(DISTINCT v.gbif_id)::int AS registros, min(v.anio) AS anio_min, max(v.anio) AS anio_max,
            count(DISTINCT v.gbif_id) FILTER (WHERE ${tieneFoto})::int AS con_foto
       ${f.desde} WHERE ${donde}`,
    ctx.params);
  return r;
}

async function totalesAgregados(client, lote, filtros) {
  const ctx = crearContexto();
  const idLote = ctx.p(lote.id);
  const donde = condicionesTerritorio(ctx, filtros, 's.codigo');
  const territorio = donde.length ? ` AND ${donde.join(' AND ')}` : '';
  const unir = `JOIN biodiversidad.municipio m ON m.territorio_huella = s.territorio_huella AND m.codigo = s.codigo`;
  const { rows: [reg] } = await client.query(
    `SELECT COALESCE(sum(s.registros), 0)::int AS registros
       FROM biodiversidad.resumen_territorial s ${unir} WHERE s.lote_id = ${idLote}${territorio}`, ctx.params);
  const { rows: [anios] } = await client.query(
    `SELECT min(CASE WHEN f.valor ~ ${ANIO_VALIDO} THEN f.valor::int END) AS anio_min,
            max(CASE WHEN f.valor ~ ${ANIO_VALIDO} THEN f.valor::int END) AS anio_max
       FROM biodiversidad.faceta_municipal f
       JOIN biodiversidad.resumen_territorial s ON s.lote_id = f.lote_id AND s.codigo = f.codigo ${unir}
      WHERE f.lote_id = ${idLote} AND f.faceta = 'anio'${territorio}`, ctx.params);
  return { ...reg, ...anios, con_foto: null };
}

export async function resumen(filtros) {
  return conLimite(async (client) => {
    const lote = await loteActivo(client, filtros.grupo);
    if (!lote) return null;
    const totales = lote.metodo === 'individual'
      ? await totalesIndividuales(client, lote, filtros)
      : await totalesAgregados(client, lote, filtros);
    const e = await conteosEspecies(client, lote, filtros);
    return {
      grupo: lote.grupo,
      metodo: lote.metodo,
      alcance: { codigo_municipal: filtros.codigo_municipal ?? null, departamento: filtros.departamento ?? null },
      registros: totales.registros,
      especies: e.especies,
      con_foto: totales.con_foto,
      amenazadas: { CR: e.cr, EN: e.en, VU: e.vu, total: e.cr + e.en + e.vu },
      endemicas_colombia: e.endemicas_colombia,
      endemicas_choco: e.endemicas_choco,
      introducidas: e.introducidas,
      invasoras: e.invasoras,
      anio_min: totales.anio_min ?? null,
      anio_max: totales.anio_max ?? null,
    };
  });
}
