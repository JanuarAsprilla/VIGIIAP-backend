import { conLimite, loteActivo, crearContexto, condicionesTerritorio } from './comun.js';
import { alcance } from './alcance.js';
import { hayFiltrosEspecie } from './filtros.js';
import { sqlTieneFoto, PATRON_IMAGEN, PATRON_REFERENCIA } from './fotos.js';
import { validarInventario, usaFuente } from './reglas_inventario.js';

const ANIO_VALIDO = `'^[0-9]{4}$'`;
const UNIR_MUNICIPIO = `JOIN biodiversidad.municipio m ON m.territorio_huella = s.territorio_huella AND m.codigo = s.codigo`;

/** Conteos de especies distintas por categoría de conservación a partir de un CTE `sp(clasificacion_clave, especie_clave)`. */
const CONTEOS_ESPECIES = `
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
           ON ec.clasificacion_clave = sp.clasificacion_clave AND ec.especie_clave = sp.especie_clave`;

/** Individuales: se reduce a registros únicos (uno asignado a dos municipios cuenta una vez) y se agrega todo de ahí. */
async function individuales(client, lote, filtros) {
  const ctx = crearContexto();
  const { desde, where } = alcance(ctx, lote, filtros);
  const foto = sqlTieneFoto('v.fotos', ctx.p(PATRON_IMAGEN), ctx.p(PATRON_REFERENCIA));
  const { rows: [r] } = await client.query(
    `WITH r AS (
       SELECT DISTINCT ON (v.gbif_id) v.gbif_id, v.anio, v.dataset_key, t.clasificacion_clave, t.especie_clave,
              ${foto} AS con_foto, (NOT v.coordenadas_ocultas AND v.latitud IS NOT NULL AND v.longitud IS NOT NULL) AS con_ubicacion
         ${desde} WHERE ${where} ORDER BY v.gbif_id),
     sp AS (SELECT DISTINCT clasificacion_clave, especie_clave FROM r WHERE especie_clave IS NOT NULL),
     tot AS (
       SELECT count(*)::int AS registros, min(anio) AS anio_min, max(anio) AS anio_max,
              count(*) FILTER (WHERE con_foto)::int AS con_foto, count(*) FILTER (WHERE con_ubicacion)::int AS con_ubicacion,
              count(DISTINCT dataset_key)::int AS conjuntos,
              (SELECT count(DISTINCT c.entidad_clave)::int FROM biodiversidad.conjunto c WHERE c.clave IN (SELECT dataset_key FROM r)) AS entidades
         FROM r),
     esp AS (${CONTEOS_ESPECIES})
     SELECT * FROM tot, esp`, ctx.params);
  return r;
}

const SIN_CONSERVACION = { especies: null, cr: null, en: null, vu: null, endemicas_colombia: null, endemicas_choco: null, introducidas: null, invasoras: null };

async function porInventario(client, lote, filtros) {
  const ctx = crearContexto();
  const { desde, where } = alcance(ctx, lote, filtros);
  const { rows: [r] } = await client.query(
    `WITH sp AS (SELECT DISTINCT t.clasificacion_clave, t.especie_clave ${desde} WHERE ${where} AND t.especie_clave IS NOT NULL),
          esp AS (${CONTEOS_ESPECIES}),
          tot AS (SELECT COALESCE(sum(ie.registros), 0)::int AS registros ${desde} WHERE ${where})
     SELECT * FROM tot, esp`, ctx.params);
  return { ...r, anio_min: null, anio_max: null, con_foto: null, con_ubicacion: null, entidades: null, conjuntos: null };
}

/** Condiciones SQL de entidad/conjunto sobre `conteo_fuente cf` + `conjunto c` (vacías si no se filtra por fuente). */
function condicionesFuente(ctx, filtros) {
  const cond = [];
  if (filtros.dataset_key != null) cond.push(`cf.dataset_key = ${ctx.p(filtros.dataset_key)}`);
  if (filtros.entidad_clave != null) cond.push(`c.entidad_clave = ${ctx.p(filtros.entidad_clave)}`);
  return cond.map((c) => ` AND ${c}`).join('');
}

/** Un contexto de parámetros por consulta: cada `$n` se usa en la consulta que lo declara. */
function nuevaConsulta(lote, filtros) {
  const ctx = crearContexto();
  const idLote = ctx.p(lote.id);
  const donde = condicionesTerritorio(ctx, filtros, 's.codigo');
  return { ctx, idLote, territorio: donde.length ? ` AND ${donde.join(' AND ')}` : '' };
}

const UNIR_FUENTE = `JOIN biodiversidad.conteo_fuente cf ON cf.lote_id = s.lote_id AND cf.codigo = s.codigo
  JOIN biodiversidad.conjunto c ON c.clave = cf.dataset_key`;

/** Agregados sin filtros de especie: totales del corte (o de las fuentes elegidas), años de las facetas y fuentes. */
async function agregadosTerritorio(client, lote, filtros) {
  const deFuente = usaFuente(filtros);
  const q1 = nuevaConsulta(lote, filtros);
  const f1 = deFuente ? condicionesFuente(q1.ctx, filtros) : '';
  const { rows: [reg] } = await client.query(
    `SELECT ${deFuente ? 'COALESCE(sum(cf.registros), 0)' : 'COALESCE(sum(s.registros), 0)'}::int AS registros
       FROM biodiversidad.resumen_territorial s ${UNIR_MUNICIPIO} ${deFuente ? UNIR_FUENTE : ''}
      WHERE s.lote_id = ${q1.idLote}${q1.territorio}${f1}`, q1.ctx.params);
  const q2 = nuevaConsulta(lote, filtros);
  const { rows: [anios] } = await client.query(
    `SELECT min(CASE WHEN f.valor ~ ${ANIO_VALIDO} THEN f.valor::int END) AS anio_min,
            max(CASE WHEN f.valor ~ ${ANIO_VALIDO} THEN f.valor::int END) AS anio_max
       FROM biodiversidad.faceta_municipal f
       JOIN biodiversidad.resumen_territorial s ON s.lote_id = f.lote_id AND s.codigo = f.codigo ${UNIR_MUNICIPIO}
      WHERE f.lote_id = ${q2.idLote} AND f.faceta = 'anio'${q2.territorio}`, q2.ctx.params);
  const q3 = nuevaConsulta(lote, filtros);
  const f3 = condicionesFuente(q3.ctx, filtros);
  const { rows: [fuentes] } = await client.query(
    `SELECT count(DISTINCT cf.dataset_key)::int AS conjuntos, count(DISTINCT c.entidad_clave)::int AS entidades
       FROM biodiversidad.resumen_territorial s ${UNIR_MUNICIPIO} ${UNIR_FUENTE}
      WHERE s.lote_id = ${q3.idLote}${q3.territorio}${f3}`, q3.ctx.params);
  return { ...reg, ...anios, ...fuentes, con_foto: null, con_ubicacion: null };
}

async function agregados(client, lote, filtros) {
  validarInventario(filtros, { fuente: true });
  if (hayFiltrosEspecie(filtros)) return porInventario(client, lote, filtros);
  const base = await agregadosTerritorio(client, lote, filtros);
  if (usaFuente(filtros)) return { ...base, ...SIN_CONSERVACION };
  const ctx = crearContexto();
  const { desde, where } = alcance(ctx, lote, filtros);
  const { rows: [e] } = await client.query(
    `WITH sp AS (SELECT DISTINCT t.clasificacion_clave, t.especie_clave ${desde} WHERE ${where} AND t.especie_clave IS NOT NULL)
     ${CONTEOS_ESPECIES}`, ctx.params);
  return { ...base, ...e };
}

const total = (...n) => (n.some((x) => x == null) ? null : n.reduce((a, b) => a + b, 0));

export async function resumen(filtros) {
  return conLimite(async (client) => {
    const lote = await loteActivo(client, filtros.grupo);
    if (!lote) return null;
    const r = lote.metodo === 'individual' ? await individuales(client, lote, filtros) : await agregados(client, lote, filtros);
    return {
      grupo: lote.grupo,
      metodo: lote.metodo,
      alcance: { codigo_municipal: filtros.codigo_municipal ?? null, departamento: filtros.departamento ?? null },
      registros: r.registros,
      especies: r.especies,
      con_foto: r.con_foto,
      amenazadas: { CR: r.cr, EN: r.en, VU: r.vu, total: total(r.cr, r.en, r.vu) },
      endemicas_colombia: r.endemicas_colombia,
      endemicas_choco: r.endemicas_choco,
      introducidas: r.introducidas,
      invasoras: r.invasoras,
      anio_min: r.anio_min ?? null,
      anio_max: r.anio_max ?? null,
      entidades: r.entidades ?? null,
      conjuntos: r.conjuntos ?? null,
      con_ubicacion: r.con_ubicacion ?? null,
    };
  });
}
