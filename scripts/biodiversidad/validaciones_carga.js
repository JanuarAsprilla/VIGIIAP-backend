/**
 * Comprobaciones de coherencia del cargador de biodiversidad. Todas lanzan un Error con un mensaje claro y, como el
 * cargador es atómico, abortan la transacción completa: no queda nada cargado ni activado.
 */

/** Mínimos para activar un cruce de conservación y proporción mínima respecto al cruce activo. */
export const MINIMOS_CRUCE = Object.freeze({ afirmaciones: 100, vinculos: 100 });
export const PROPORCION_CRUCE = 0.9;
/** Un corte activable con menos de esta proporción de los registros del activo se rechaza. */
export const PROPORCION_REGRESION = 0.5;

/** Tablas que un manifiesto de un formato anterior puede no declarar (se completan sobre cortes ya cargados). */
const OPCIONALES = new Set(['registro_detalle']);

/** El manifiesto declara todas las tablas permitidas y cada conteo coincide con lo leído. */
export function verificarManifiesto(conteos, leidas, permitidas) {
  for (const tabla of permitidas) {
    if (OPCIONALES.has(tabla) && conteos[tabla] === undefined && !leidas[tabla]) continue;
    if (!Number.isInteger(conteos[tabla])) throw new Error(`El manifiesto no declara la tabla ${tabla}`);
    if ((leidas[tabla] ?? 0) !== conteos[tabla]) {
      throw new Error(`El manifiesto declara ${conteos[tabla]} filas de ${tabla} y se leyeron ${leidas[tabla] ?? 0}`);
    }
  }
}

const DESCUADRE = (lote, detalle) => new Error(`El corte agregado ${lote.grupo} no cuadra: ${detalle}`);

/**
 * ¿Cuadra el municipio? Inventario + sin_especie = registros; o, si el inventario ya incluye los taxones sin especie,
 * inventario = registros y esos taxones suman sin_especie.
 */
export function municipioCuadra({ registros, sin_especie: sinEspecie, inventario, inventario_sin_especie: invSin, fuente }) {
  const inventarioOk = inventario + sinEspecie === registros || (inventario === registros && invSin === sinEspecie);
  return inventarioOk && fuente === registros;
}

/** Lote agregado: Σ resumen = lote.registros y, por municipio, inventario y fuentes suman lo declarado. */
export async function verificarAgregado(client, lote) {
  const { rows: [t] } = await client.query(
    `SELECT l.registros::bigint AS declarados, COALESCE((SELECT sum(registros) FROM biodiversidad.resumen_territorial WHERE lote_id = l.id), 0)::bigint AS suma
       FROM biodiversidad.lote l WHERE l.id = $1`, [lote.id]);
  if (String(t.declarados) !== String(t.suma)) {
    throw DESCUADRE(lote, `declara ${t.declarados} registros y los municipios suman ${t.suma}`);
  }
  const { rows } = await client.query(
    `SELECT s.codigo, s.registros::bigint AS registros, s.sin_especie::bigint AS sin_especie,
            COALESCE((SELECT sum(ie.registros) FROM biodiversidad.inventario_especie ie
                       WHERE ie.lote_id = s.lote_id AND ie.codigo = s.codigo), 0)::bigint AS inventario,
            COALESCE((SELECT sum(ie.registros) FROM biodiversidad.inventario_especie ie
                        JOIN biodiversidad.taxon_version tv ON tv.huella = ie.taxon_huella
                       WHERE ie.lote_id = s.lote_id AND ie.codigo = s.codigo AND tv.especie_clave IS NULL), 0)::bigint AS inventario_sin_especie,
            COALESCE((SELECT sum(cf.registros) FROM biodiversidad.conteo_fuente cf
                       WHERE cf.lote_id = s.lote_id AND cf.codigo = s.codigo), 0)::bigint AS fuente
       FROM biodiversidad.resumen_territorial s WHERE s.lote_id = $1 ORDER BY s.codigo`, [lote.id]);
  for (const fila of rows) {
    const f = Object.fromEntries(Object.entries(fila).map(([k, v]) => [k, k === 'codigo' ? v : Number(v)]));
    if (!municipioCuadra(f)) {
      throw DESCUADRE(lote, `municipio ${f.codigo}: registros ${f.registros}, sin especie ${f.sin_especie}, inventario ${f.inventario}, fuentes ${f.fuente}`);
    }
  }
}

const contarCruce = async (client, id) => {
  const { rows: [r] } = await client.query(
    `SELECT (SELECT count(*) FROM biodiversidad.conservacion_afirmacion WHERE importacion_id = $1)::int AS afirmaciones,
            (SELECT count(*) FROM biodiversidad.conservacion_vinculo v
               JOIN biodiversidad.conservacion_afirmacion a ON a.id = v.afirmacion_id WHERE a.importacion_id = $1)::int AS vinculos`, [id]);
  return r;
};

/** Antes de activar un cruce: mínimo de afirmaciones y vínculos y, si hay uno activo, no bajar del 90 % de él. */
export async function verificarCruce(client, id, minimos = MINIMOS_CRUCE) {
  const nuevo = await contarCruce(client, id);
  for (const campo of ['afirmaciones', 'vinculos']) {
    if (nuevo[campo] < minimos[campo]) {
      throw new Error(`El cruce de conservación tiene ${nuevo[campo]} ${campo} y el mínimo para activarlo es ${minimos[campo]}`);
    }
  }
  const { rows: [activo] } = await client.query(
    'SELECT id FROM biodiversidad.conservacion_importacion WHERE activo AND id <> $1', [id]);
  if (!activo) return;
  const previo = await contarCruce(client, activo.id);
  for (const campo of ['afirmaciones', 'vinculos']) {
    if (nuevo[campo] < previo[campo] * PROPORCION_CRUCE) {
      throw new Error(`El cruce de conservación nuevo tiene ${nuevo[campo]} ${campo} frente a ${previo[campo]} del activo (menos del ${PROPORCION_CRUCE * 100} %)`);
    }
  }
}

/** Un corte con menos de la mitad de los registros del activo del mismo grupo solo se activa con `permitirRegresion`. */
export async function verificarRegresion(client, { id, grupo }, permitirRegresion = false) {
  if (permitirRegresion) return;
  const { rows: [r] } = await client.query(
    `SELECT n.registros::bigint AS nuevo, a.registros::bigint AS activo
       FROM biodiversidad.lote n JOIN biodiversidad.lote a ON a.grupo = n.grupo AND a.activo AND a.id <> n.id
      WHERE n.id = $1`, [id]);
  if (r && Number(r.nuevo) < Number(r.activo) * PROPORCION_REGRESION) {
    throw new Error(`El corte ${grupo} tiene ${r.nuevo} registros frente a ${r.activo} del activo (menos del ${PROPORCION_REGRESION * 100} %); use --permitir-regresion si es intencional`);
  }
}
