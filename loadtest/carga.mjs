#!/usr/bin/env node
/**
 * Prueba de carga sin dependencias: N trabajadores concurrentes piden rutas ponderadas durante
 * una duración fija y se reportan latencias por ruta. Sale con código 1 si no cumple los umbrales.
 *
 *   node loadtest/carga.mjs --url http://localhost:3000 --duracion 30 --concurrencia 20
 *
 * Úsala contra un entorno propio: los límites de tasa por IP (429) se verán con una sola máquina.
 */
import { parseArgs } from 'node:util';
import { performance } from 'node:perf_hooks';
import { resumir, evaluarUmbrales, elegirRuta } from './estadisticas.mjs';

const ESCENARIOS = {
  publico: [
    { ruta: '/api/v1/estado', peso: 2 },
    { ruta: '/api/v1/public/configuracion', peso: 2 },
    { ruta: '/api/v1/mapas?page=1&limit=12', peso: 4 },
    { ruta: '/api/v1/documentos?page=1&limit=12', peso: 3 },
    { ruta: '/api/v1/categorias', peso: 2 },
    { ruta: '/api/v1/herramientas', peso: 1 },
    { ruta: '/api/v1/geovisores', peso: 3 },
  ],
  busqueda: [
    { ruta: '/api/v1/mapas?q=rio', peso: 3 },
    { ruta: '/api/v1/mapas?q=bosque&page=2', peso: 2 },
    { ruta: '/api/v1/documentos?q=biodiversidad', peso: 3 },
  ],
};

const { values } = parseArgs({
  options: {
    url: { type: 'string', default: 'http://localhost:3000' },
    escenario: { type: 'string', default: 'publico' },
    duracion: { type: 'string', default: '20' },
    concurrencia: { type: 'string', default: '10' },
    'umbral-p95': { type: 'string', default: '500' },
    'umbral-error': { type: 'string', default: '0.01' },
  },
});

const rutas = ESCENARIOS[values.escenario];
if (!rutas) {
  console.error(`Escenario desconocido: ${values.escenario}. Disponibles: ${Object.keys(ESCENARIOS).join(', ')}`);
  process.exit(2);
}

const duracionSeg = Number(values.duracion);
const base = values.url.replace(/\/$/, '');
const medidas = new Map(rutas.map((r) => [r.ruta, { latencias: [], estados: [] }]));

async function trabajador(finaliza) {
  while (performance.now() < finaliza) {
    const { ruta } = elegirRuta(rutas, Math.random());
    const inicio = performance.now();
    let estado;
    try {
      const respuesta = await fetch(base + ruta, { signal: globalThis.AbortSignal.timeout(15_000) });
      await respuesta.arrayBuffer();
      estado = respuesta.status;
    } catch {
      estado = 0;
    }
    const medida = medidas.get(ruta);
    medida.latencias.push(performance.now() - inicio);
    medida.estados.push(estado);
  }
}

const inicio = performance.now();
await Promise.all(Array.from({ length: Number(values.concurrencia) }, () => trabajador(inicio + duracionSeg * 1000)));
const real = (performance.now() - inicio) / 1000;

const fila = (nombre, r) => `${nombre.padEnd(40)} ${String(r.total).padStart(7)} ${r.rps.toFixed(1).padStart(8)} ${r.p50.toFixed(0).padStart(6)} ${r.p95.toFixed(0).padStart(6)} ${r.p99.toFixed(0).padStart(6)} ${String(r.limitadas).padStart(6)} ${String(r.errores).padStart(6)}`;
console.log(`\nEscenario "${values.escenario}" · ${values.concurrencia} trabajadores · ${real.toFixed(1)} s · ${base}\n`);
console.log(`${'ruta'.padEnd(40)} ${'total'.padStart(7)} ${'rps'.padStart(8)} ${'p50'.padStart(6)} ${'p95'.padStart(6)} ${'p99'.padStart(6)} ${'429'.padStart(6)} ${'error'.padStart(6)}`);
for (const [ruta, medida] of medidas) console.log(fila(ruta, resumir({ ...medida, duracionSeg: real })));

const todas = { latencias: [...medidas.values()].flatMap((m) => m.latencias), estados: [...medidas.values()].flatMap((m) => m.estados) };
const global = resumir({ ...todas, duracionSeg: real });
console.log(`\n${fila('TOTAL', global)}`);

const { aprobado, fallos } = evaluarUmbrales(global, { p95Ms: Number(values['umbral-p95']), tasaErrorMax: Number(values['umbral-error']) });
if (global.limitadas) console.log(`\nAviso: ${global.limitadas} respuestas 429; sube el límite de tasa del entorno de prueba para medir el servicio y no el limitador.`);
console.log(aprobado ? '\nAPROBADO' : `\nFALLÓ:\n- ${fallos.join('\n- ')}`);
process.exit(aprobado ? 0 : 1);
