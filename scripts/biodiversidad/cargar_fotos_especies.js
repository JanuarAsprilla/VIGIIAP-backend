/**
 * Carga las fotos representativas por especie (grupos agregados) en `biodiversidad.especie_foto`.
 *
 *   node scripts/biodiversidad/cargar_fotos_especies.js <archivo.ndjson[.gz]>
 *
 * Cada línea: {"especie_clave","imagen","autor","editor","licencia","referencia"}. El archivo lo genera
 * buscar_fotos_especies.mjs fuera de la API. Garantías: una sola transacción, rol aislado
 * `biodiversidad_ingesta`, cada línea pasa por `filaFotoEspecie` (imagen solo de la caché de GBIF, referencia https,
 * seis campos), las líneas inválidas se descartan y se cuentan, y repetir la carga actualiza sin duplicar.
 */
import { createReadStream } from 'fs';
import { createGunzip } from 'zlib';
import { createInterface } from 'readline';
import { fileURLToPath } from 'url';
import pool, { getClient } from '../../src/config/database.js';
import { filaFotoEspecie } from '../../src/modules/biodiversidad/consultas/fotos.js';

const ROL_INGESTA = 'biodiversidad_ingesta';
const TAMANO_LOTE = 1000;
const MAX_LINEAS = 200_000;

async function* lineas(ruta) {
  const entrada = ruta.endsWith('.gz') ? createReadStream(ruta).pipe(createGunzip()) : createReadStream(ruta);
  for await (const linea of createInterface({ input: entrada, crlfDelay: Infinity })) {
    if (linea.trim() !== '') yield linea;
  }
}

/** Lee el archivo y devuelve las filas válidas (la última gana si una especie se repite) y cuántas se descartaron. */
export async function leerFotos(ruta) {
  const porClave = new Map();
  let leidas = 0;
  let descartadas = 0;
  for await (const linea of lineas(ruta)) {
    leidas += 1;
    if (leidas > MAX_LINEAS) throw new Error(`El archivo supera ${MAX_LINEAS} líneas`);
    let fila;
    try { fila = filaFotoEspecie(JSON.parse(linea)); } catch { fila = null; }
    if (fila) porClave.set(fila.especie_clave, fila); else descartadas += 1;
  }
  return { filas: [...porClave.values()], leidas, descartadas };
}

async function guardar(client, filas) {
  for (let i = 0; i < filas.length; i += TAMANO_LOTE) {
    const lote = filas.slice(i, i + TAMANO_LOTE);
    await client.query(
      `INSERT INTO biodiversidad.especie_foto (especie_clave, imagen, autor, editor, licencia, referencia)
       SELECT * FROM unnest($1::text[], $2::text[], $3::text[], $4::text[], $5::text[], $6::text[])
       ON CONFLICT (especie_clave) DO UPDATE
         SET imagen = EXCLUDED.imagen, autor = EXCLUDED.autor, editor = EXCLUDED.editor,
             licencia = EXCLUDED.licencia, referencia = EXCLUDED.referencia, actualizado = now()`,
      ['especie_clave', 'imagen', 'autor', 'editor', 'licencia', 'referencia'].map((c) => lote.map((f) => f[c])));
  }
}

export async function cargarFotosEspecies(ruta) {
  const { filas, leidas, descartadas } = await leerFotos(ruta);
  const client = await getClient();
  try {
    await client.query('BEGIN');
    await client.query(`SET LOCAL ROLE ${ROL_INGESTA}`);
    await guardar(client, filas);
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
  return { leidas, cargadas: filas.length, descartadas };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const ruta = process.argv[2];
  (ruta ? cargarFotosEspecies(ruta) : Promise.reject(new Error('Uso: cargar_fotos_especies.js <archivo.ndjson[.gz]>')))
    .then((r) => { process.stdout.write(`${JSON.stringify(r, null, 2)}\n`); return pool.end(); })
    .catch((err) => {
      process.stderr.write(`Error: ${err.message}\n`);
      return pool.end().finally(() => process.exit(1));
    });
}
