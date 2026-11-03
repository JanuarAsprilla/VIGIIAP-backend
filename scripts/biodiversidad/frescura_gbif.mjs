/**
 * Mide cuántos registros publica GBIF hoy para cada grupo en la región, SIN cuenta (API pública, solo conteos).
 * Corre fuera de la API y sin credenciales de base de datos; su salida se registra con
 * `actualizar.js frescura`, que la compara con la primera medición (la línea base) para estimar cuánto han crecido
 * los datos de GBIF desde el corte cargado.
 *
 *   node scripts/biodiversidad/frescura_gbif.mjs --salida frescura.json
 *
 * La medición es un termómetro estable, no una réplica del corte: caja que envuelve la región, país Colombia,
 * con coordenadas y desde el año 2000. Se repite siempre igual para que las diferencias entre meses sean comparables.
 */
import { writeFileSync } from 'node:fs';

const GBIF = 'https://api.gbif.org/v1/occurrence/search';
const CAJA = 'POLYGON((-79.01 0.816, -75.861 0.816, -75.861 8.678, -79.01 8.678, -79.01 0.816))';
const TAXON = {
  // GBIF ya no tiene la clase Reptilia: los reptiles son las clases Squamata, Testudines y Crocodylia.
  aves: 'classKey=212', mamiferos: 'classKey=359', anfibios: 'classKey=131',
  reptiles: 'taxonKey=11592253&taxonKey=11418114&taxonKey=11493978',
  insectos: 'classKey=216', plantas: 'kingdomKey=6', hongos: 'kingdomKey=5',
};

const dormir = (ms) => new Promise((r) => { setTimeout(r, ms); });

async function contar(filtro, intentos = 4) {
  const anio = new Date().getUTCFullYear();
  const q = `${filtro}&country=CO&hasCoordinate=true&year=2000,${anio}&geometry=${encodeURIComponent(CAJA)}&limit=0`;
  for (let i = 0; i < intentos; i += 1) {
    try {
      const r = await fetch(`${GBIF}?${q}`, { headers: { accept: 'application/json', 'user-agent': 'vigiiap-frescura' } });
      if (r.ok) {
        const { count } = await r.json();
        if (Number.isInteger(count) && count >= 0) return count;
      } else if (r.status !== 429 && r.status < 500) {
        break;
      }
    } catch { /* red: se reintenta */ }
    await dormir(1500 * (i + 1) ** 2);
  }
  throw new Error(`GBIF no respondió el conteo de ${filtro}`);
}

async function main() {
  const i = process.argv.indexOf('--salida');
  const salida = i >= 0 ? process.argv[i + 1] : null;
  if (!salida) throw new Error('Falta --salida <archivo.json>');
  const grupos = {};
  for (const [grupo, filtro] of Object.entries(TAXON)) {
    grupos[grupo] = await contar(filtro);
    process.stdout.write(`${grupo}: ${grupos[grupo]}\n`);
  }
  writeFileSync(salida, `${JSON.stringify({ generado: new Date().toISOString(), grupos })}\n`);
}

main().catch((err) => { process.stderr.write(`Error: ${err.message}\n`); process.exit(1); });
