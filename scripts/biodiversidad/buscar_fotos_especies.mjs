/**
 * Busca UNA fotografía representativa por especie para los grupos agregados (aves, insectos, plantas).
 * Se ejecuta a mano, fuera del servidor y de la API (la API de consulta nunca sale a internet):
 *
 *   node scripts/biodiversidad/buscar_fotos_especies.mjs --salida fotos.ndjson [--api https://vigiiap.iiap.org.co]
 *        [--grupos aves,insectos,plantas] [--concurrencia 4]
 *
 * 1. Lee las especies de cada grupo desde la API pública de Vigía.
 * 2. Para cada una pide a GBIF ocurrencias con imagen (primero de Colombia, después de cualquier país) y elige la
 *    primera con licencia Creative Commons y fuente https.
 * 3. Guarda la imagen como referencia a la caché de GBIF (md5 del identificador original), nunca la URL del autor.
 * Se puede interrumpir y repetir: lo ya resuelto (con o sin foto) está en <salida>.parcial y no se vuelve a pedir.
 * El resultado se carga con cargar_fotos_especies.js.
 */
import { createHash } from 'node:crypto';
import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';

const GBIF = 'https://api.gbif.org/v1/occurrence/search';
const ANCHO = 400;
const LICENCIA_CC = /^https?:\/\/creativecommons\.org\/(licenses\/by[a-z-]*|publicdomain\/zero)\//;
const ES_HTTPS = /^https:\/\/\S+$/;
const LICENCIAS = ['CC0_1_0', 'CC_BY_4_0', 'CC_BY_NC_4_0'].map((l) => `&license=${l}`).join('');

function argumento(nombre, porDefecto) {
  const i = process.argv.indexOf(`--${nombre}`);
  return i >= 0 ? process.argv[i + 1] : porDefecto;
}

const dormir = (ms) => new Promise((r) => { setTimeout(r, ms); });

/** Respuesta cuando el servicio falla (red, 429, 5xx) tras varios intentos: distinta de «no hay datos» (null). */
export const FALLO = Symbol('fallo');

// Pocos reintentos y tiempo límite corto: unas pocas especies hacen que GBIF tarde decenas de segundos; es mejor
// saltarlas (quedan sin anotar y se reintentan en la próxima ejecución) que dejar a un trabajador esperándolas.
async function pedirJson(url, intentos = 2) {
  for (let i = 0; i < intentos; i += 1) {
    try {
      // Con tiempo límite: una conexión colgada no debe dejar a un trabajador esperando para siempre.
      const r = await fetch(url, { headers: { accept: 'application/json', 'user-agent': 'vigiiap-fotos-especies' }, signal: globalThis.AbortSignal.timeout(15_000) });
      if (r.ok) return await r.json();
      if (r.status !== 429 && r.status < 500) return null;
    } catch { /* red: se reintenta */ }
    await dormir(800 * (i + 1) ** 2);
  }
  return FALLO;
}

async function especiesDe(api, grupo) {
  const claves = [];
  for (let pagina = 1; pagina <= 100; pagina += 1) {
    const d = await pedirJson(`${api}/api/v1/biodiversidad/especies?grupo=${grupo}&tamano=100&pagina=${pagina}`);
    if (d === FALLO) throw new Error(`La API de Vigía no respondió al pedir las especies de ${grupo} (página ${pagina})`);
    if (!d || d.especies.length === 0) break;
    claves.push(...d.especies.map((e) => e.especie_clave));
    if (claves.length >= d.total) break;
  }
  return claves;
}

/** Primera imagen con licencia CC y fuente https de una lista de ocurrencias. */
export function elegirFoto(clave, ocurrencias) {
  for (const o of ocurrencias) {
    for (const m of o.media ?? []) {
      if (m.type !== 'StillImage' || !ES_HTTPS.test(m.identifier ?? '') || !LICENCIA_CC.test(m.license ?? '')) continue;
      const referencia = ES_HTTPS.test(m.references ?? '') ? m.references : `https://www.gbif.org/occurrence/${o.key}`;
      const md5 = createHash('md5').update(m.identifier).digest('hex');
      return {
        especie_clave: String(clave),
        imagen: `https://api.gbif.org/v1/image/cache/${ANCHO}x/occurrence/${o.key}/media/${md5}`,
        autor: m.creator ?? m.rightsHolder ?? null, editor: m.publisher ?? null, licencia: m.license, referencia,
      };
    }
  }
  return null;
}

async function fotoDe(clave) {
  for (const pais of ['&country=CO', '']) {
    // El filtro de licencia va en la consulta (GBIF responde mucho más rápido con pocas ocurrencias).
    const d = await pedirJson(`${GBIF}?taxonKey=${encodeURIComponent(clave)}&mediaType=StillImage${LICENCIAS}${pais}&limit=3`);
    if (d === FALLO) return FALLO;
    const foto = d ? elegirFoto(clave, d.results ?? []) : null;
    if (foto) return foto;
  }
  return null;
}

async function main() {
  const salida = argumento('salida');
  if (!salida) throw new Error('Falta --salida <archivo.ndjson>');
  const api = argumento('api', 'https://vigiiap.iiap.org.co').replace(/\/$/, '');
  const grupos = argumento('grupos', 'aves,insectos,plantas').split(',');
  const concurrencia = Math.min(12, Math.max(1, Number(argumento('concurrencia', '4'))));
  const parcial = `${salida}.parcial`;

  const hechas = new Set();
  if (existsSync(parcial)) {
    for (const l of readFileSync(parcial, 'utf8').split('\n')) if (l) hechas.add(JSON.parse(l).especie_clave);
  }
  const pendientes = [];
  for (const g of grupos) {
    const claves = await especiesDe(api, g);
    process.stdout.write(`${g}: ${claves.length} especies\n`);
    pendientes.push(...claves.filter((c) => !hechas.has(String(c))));
  }
  process.stdout.write(`Por buscar: ${pendientes.length}\n`);

  let hechos = 0;
  let conFoto = 0;
  let fallos = 0;
  let seguidos = 0;
  async function trabajador() {
    for (let clave = pendientes.shift(); clave !== undefined; clave = pendientes.shift()) {
      const foto = await fotoDe(clave);
      if (foto === FALLO) {
        // GBIF falló: no se anota nada (se reintentará en la próxima ejecución) y, si es una caída, se espera.
        fallos += 1;
        seguidos += 1;
        if (seguidos >= 10) { process.stdout.write('GBIF no responde: espero 60 s\n'); await dormir(60_000); seguidos = 0; }
        continue;
      }
      seguidos = 0;
      appendFileSync(parcial, `${JSON.stringify(foto ?? { especie_clave: String(clave), sin_foto: true })}\n`);
      hechos += 1;
      if (foto) conFoto += 1;
      if (hechos % 100 === 0) process.stdout.write(`${hechos} resueltas, ${conFoto} con foto\n`);
      await dormir(120);
    }
  }
  await Promise.all(Array.from({ length: concurrencia }, trabajador));

  const lineas = readFileSync(parcial, 'utf8').split('\n').filter(Boolean).filter((l) => !JSON.parse(l).sin_foto);
  writeFileSync(salida, `${lineas.join('\n')}\n`);
  process.stdout.write(`Listo: ${lineas.length} fotos en ${salida}${fallos ? `; ${fallos} especies sin resolver por fallos de GBIF (se reintentan al repetir)` : ''}\n`);
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop())) {
  main().catch((err) => { process.stderr.write(`Error: ${err.message}\n`); process.exit(1); });
}
