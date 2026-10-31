import { getClient } from '../../../config/database.js';
import { ConsultaInvalida } from '../biodiversidad.errores.js';
import { plegarSql, patronBusqueda } from './texto.js';

const LIMITE_CONSULTA_MS = 5000;
export const LOTE_ACTIVO = `activo AND estado = 'completo'`;
const ORDEN_AMENAZA = { CR: 1, EN: 2, VU: 3 };

/** Ejecuta `fn` en una transacción de solo lectura con tope de tiempo: una consulta pesada no acapara la BD. */
export async function conLimite(fn) {
  const client = await getClient();
  try {
    await client.query('BEGIN READ ONLY');
    await client.query(`SET LOCAL statement_timeout = ${LIMITE_CONSULTA_MS}`);
    const resultado = await fn(client);
    await client.query('COMMIT');
    return resultado;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

export async function loteActivo(client, grupo) {
  const { rows: [lote] } = await client.query(
    `SELECT id, grupo, metodo, desde, hasta FROM biodiversidad.lote WHERE ${LOTE_ACTIVO} AND grupo = $1`, [grupo]);
  return lote ?? null;
}

export function exigirIndividual(lote) {
  if (lote.metodo !== 'individual') {
    throw new ConsultaInvalida('Este grupo solo tiene inventario agregado: consulte el resumen por municipio.');
  }
}

/** Acumula los parámetros de una consulta: el valor nunca se concatena al SQL, solo viaja por `$n`. */
export function crearContexto() {
  const params = [];
  return { params, p: (valor) => { params.push(valor); return `$${params.length}`; } };
}

const DESDE_INDIVIDUALES = `
  FROM biodiversidad.vw_registro_publico v
  JOIN biodiversidad.asignacion a ON a.lote_id = v.lote_id AND a.gbif_id = v.gbif_id
  JOIN biodiversidad.municipio m ON m.territorio_huella = a.territorio_huella AND m.codigo = a.codigo
  LEFT JOIN biodiversidad.taxon_version t ON t.huella = v.taxon_huella
  LEFT JOIN biodiversidad.vw_especie_conservacion ec
         ON ec.clasificacion_clave = t.clasificacion_clave AND ec.especie_clave = t.especie_clave`;

const DESDE_INVENTARIO = `
  FROM biodiversidad.inventario_especie ie
  JOIN biodiversidad.resumen_territorial s ON s.lote_id = ie.lote_id AND s.codigo = ie.codigo
  JOIN biodiversidad.municipio m ON m.territorio_huella = s.territorio_huella AND m.codigo = s.codigo
  JOIN biodiversidad.taxon_version t ON t.huella = ie.taxon_huella
  LEFT JOIN biodiversidad.vw_especie_conservacion ec
         ON ec.clasificacion_clave = t.clasificacion_clave AND ec.especie_clave = t.especie_clave`;

/** FROM y condición de lote del corte activo, según sea individual (registros) o agregado (inventario). */
export function fuente(lote, ctx) {
  if (lote.metodo === 'individual') {
    return { desde: DESDE_INDIVIDUALES, codigo: 'a.codigo', condicionLote: `v.lote_id = ${ctx.p(lote.id)}` };
  }
  return { desde: DESDE_INVENTARIO, codigo: 'ie.codigo', condicionLote: `ie.lote_id = ${ctx.p(lote.id)}` };
}

export function condicionesTerritorio(ctx, { codigo_municipal, departamento }, columnaCodigo) {
  const donde = [];
  if (codigo_municipal != null) donde.push(`${columnaCodigo} = ${ctx.p(codigo_municipal)}`);
  if (departamento != null) donde.push(`m.departamento = ${ctx.p(departamento)}`);
  return donde;
}

/** Filtros por especie (nombre, conservación, categoría de amenaza): usan los alias t y ec de `fuente`. */
export function condicionesEspecie(ctx, { buscar, conservacion, amenaza, especie_clave }) {
  const donde = [];
  if (buscar != null) donde.push(`${plegarSql('t.especie')} LIKE ${ctx.p(patronBusqueda(buscar))} ESCAPE '\\'`);
  if (conservacion === 'amenazada') donde.push('ec.amenaza_orden IS NOT NULL');
  if (conservacion === 'endemica') donde.push('(ec.endemica_colombia OR ec.endemica_choco)');
  if (conservacion === 'introducida') donde.push('ec.introducida');
  if (conservacion === 'invasora') donde.push('ec.invasora');
  if (amenaza != null) donde.push(`ec.amenaza_orden = ${ctx.p(ORDEN_AMENAZA[amenaza])}`);
  if (especie_clave != null) donde.push(`t.especie_clave = ${ctx.p(especie_clave)}`);
  return donde;
}

/** Columnas de conservación de la especie (la amenaza más severa); falsas si no hay cruce activo. */
export const COLUMNAS_CONSERVACION = `
  CASE ec.amenaza_orden WHEN 1 THEN 'CR' WHEN 2 THEN 'EN' WHEN 3 THEN 'VU' END AS amenaza,
  COALESCE(ec.endemica_colombia, false) AS endemica_colombia, COALESCE(ec.endemica_choco, false) AS endemica_choco,
  COALESCE(ec.introducida, false) AS introducida, COALESCE(ec.invasora, false) AS invasora`;
