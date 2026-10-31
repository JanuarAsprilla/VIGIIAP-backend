import { conLimite, loteActivo, crearContexto, condicionesTerritorio } from './comun.js';
import { alcance } from './alcance.js';
import { validarInventario } from './reglas_inventario.js';

const UNIR_MUNICIPIO = (alias) => `JOIN biodiversidad.municipio m ON m.territorio_huella = ${alias}.territorio_huella AND m.codigo = ${alias}.codigo`;
const FACETAS_INVENTARIO = ['anio_desde', 'anio_hasta', 'tipo_evidencia'];

async function individuales(client, lote, filtros) {
  const ctx = crearContexto();
  const { desde, where } = alcance(ctx, lote, filtros);
  const sobre = `${desde} WHERE ${where}`;
  const { rows: por_anio } = await client.query(
    `SELECT v.anio, count(DISTINCT v.gbif_id)::int AS registros ${sobre} AND v.anio IS NOT NULL GROUP BY v.anio ORDER BY v.anio`, ctx.params);
  const { rows: por_evidencia } = await client.query(
    `SELECT v.tipo_evidencia AS tipo, count(DISTINCT v.gbif_id)::int AS registros ${sobre} AND v.tipo_evidencia IS NOT NULL
      GROUP BY v.tipo_evidencia ORDER BY registros DESC, tipo`, ctx.params);
  return { por_anio, por_evidencia };
}

/** Facetas del municipio: el rango de años acota la serie por año y el tipo de evidencia la serie por evidencia. */
async function agregados(client, lote, filtros) {
  validarInventario(filtros, { facetas: FACETAS_INVENTARIO, soloTerritorio: true });
  const consulta = (faceta, extra, valor) => {
    const ctx = crearContexto();
    const idLote = ctx.p(lote.id);
    const territorio = condicionesTerritorio(ctx, filtros, 'f.codigo').map((c) => ` AND ${c}`).join('');
    const propios = extra(ctx).map((c) => ` AND ${c}`).join('');
    return client.query(
      `SELECT ${valor.columnas}, sum(f.registros)::int AS registros
         FROM biodiversidad.faceta_municipal f
         JOIN biodiversidad.resumen_territorial s ON s.lote_id = f.lote_id AND s.codigo = f.codigo ${UNIR_MUNICIPIO('s')}
        WHERE f.lote_id = ${idLote} AND f.faceta = '${faceta}'${territorio}${propios}${valor.donde}
        GROUP BY ${valor.grupo} ORDER BY ${valor.orden}`, ctx.params);
  };
  const anio = "CASE WHEN f.valor ~ '^[0-9]{4}$' THEN f.valor::int END";
  const rangoAnios = (ctx) => [
    ...(filtros.anio_desde != null ? [`${anio} >= ${ctx.p(filtros.anio_desde)}`] : []),
    ...(filtros.anio_hasta != null ? [`${anio} <= ${ctx.p(filtros.anio_hasta)}`] : []),
  ];
  const evidencia = (ctx) => (filtros.tipo_evidencia != null ? [`f.valor = ${ctx.p(filtros.tipo_evidencia)}`] : []);
  const { rows: por_anio } = await consulta('anio', rangoAnios,
    { columnas: `${anio} AS anio`, donde: ` AND ${anio} IS NOT NULL`, grupo: '1', orden: '1' });
  const { rows: por_evidencia } = await consulta('tipo_evidencia', evidencia,
    { columnas: 'f.valor AS tipo', donde: '', grupo: 'f.valor', orden: 'registros DESC, tipo' });
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
