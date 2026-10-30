import { query, getClient } from '../../config/database.js';
import { ConsultaInvalida } from './biodiversidad.errores.js';

const LIMITE_CONSULTA_MS = 5000;

export const AVISO = 'Los conteos reflejan documentación disponible y esfuerzo de muestreo, no abundancia ni inventarios '
  + 'completos. Valide datos, coordenadas, identificaciones, fechas, licencias y categorías de conservación en las fuentes '
  + 'originales antes de usarlos. Las coordenadas de especies amenazadas se ocultan.';

/** Ejecuta `fn` en una transacción de solo lectura con tope de tiempo: una consulta pesada no acapara la BD. */
async function conLimite(fn) {
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

const LOTE_ACTIVO = `activo AND estado = 'completo'`;

export async function estado() {
  const { rows: grupos } = await query(
    `SELECT grupo, metodo, desde, hasta, registros::int AS registros, fecha_fuente, doi
       FROM biodiversidad.lote WHERE ${LOTE_ACTIVO} ORDER BY grupo`);
  const { rows: [cruce] } = await query(
    `SELECT creado_en FROM biodiversidad.conservacion_importacion WHERE activo`);
  return {
    grupos,
    conservacion: { activa: Boolean(cruce), actualizada_en: cruce?.creado_en ?? null },
    aviso: AVISO,
  };
}

async function loteActivo(client, grupo) {
  const { rows: [lote] } = await client.query(
    `SELECT id, grupo, metodo, desde, hasta FROM biodiversidad.lote WHERE ${LOTE_ACTIVO} AND grupo = $1`, [grupo]);
  return lote ?? null;
}

export async function municipios(grupo) {
  return conLimite(async (client) => {
    const lote = await loteActivo(client, grupo);
    if (!lote) return null;
    const { rows } = await client.query(
      `SELECT s.codigo AS codigo_municipal, m.nombre AS municipio, m.departamento,
              s.registros::int AS registros, s.sin_especie::int AS sin_especie
         FROM biodiversidad.resumen_territorial s
         JOIN biodiversidad.municipio m ON m.territorio_huella = s.territorio_huella AND m.codigo = s.codigo
        WHERE s.lote_id = $1
        ORDER BY m.departamento, m.nombre`, [lote.id]);
    return { grupo: lote.grupo, metodo: lote.metodo, desde: lote.desde, hasta: lote.hasta, municipios: rows };
  });
}

const DESDE_REGISTROS = `
  FROM biodiversidad.vw_registro_publico v
  JOIN biodiversidad.asignacion a ON a.lote_id = v.lote_id AND a.gbif_id = v.gbif_id
  JOIN biodiversidad.municipio m ON m.territorio_huella = a.territorio_huella AND m.codigo = a.codigo
  JOIN biodiversidad.conjunto c ON c.clave = v.dataset_key`;

/** Condiciones parametrizadas: el valor nunca se concatena al SQL. */
function condiciones({ grupo, codigo_municipal, departamento, anio_desde, anio_hasta }) {
  const params = [grupo];
  const where = ['v.grupo = $1'];
  const agregar = (sql, valor) => { params.push(valor); where.push(sql.replace('?', `$${params.length}`)); };
  if (codigo_municipal != null) agregar('a.codigo = ?', codigo_municipal);
  if (departamento != null) agregar('m.departamento = ?', departamento);
  if (anio_desde != null) agregar('v.anio >= ?', anio_desde);
  if (anio_hasta != null) agregar('v.anio <= ?', anio_hasta);
  return { params, where: where.join(' AND ') };
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
    if (lote.metodo !== 'individual') {
      throw new ConsultaInvalida('Este grupo solo tiene inventario agregado: consulte el resumen por municipio.');
    }
    const { params, where } = condiciones(filtros);
    const { rows: [{ n }] } = await client.query(`SELECT count(*)::int AS n ${DESDE_REGISTROS} WHERE ${where}`, params);
    const { rows } = await client.query(
      `SELECT v.gbif_id, v.especie, v.especie_clave, v.anio, v.tipo_evidencia, v.licencia,
              v.latitud, v.longitud, v.incertidumbre_m, v.coordenadas_ocultas,
              c.titulo AS conjunto, c.doi AS doi_conjunto,
              a.codigo AS codigo_municipal, m.nombre AS municipio, m.departamento
         ${DESDE_REGISTROS}
        WHERE ${where}
        ORDER BY v.gbif_id, a.codigo
        LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, tamano, (pagina - 1) * tamano]);
    return { grupo: lote.grupo, desde: lote.desde, hasta: lote.hasta, pagina, tamano, total: n, registros: rows };
  });
}
