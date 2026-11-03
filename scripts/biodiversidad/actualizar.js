/**
 * Orquestación de la actualización automática de biodiversidad (lado base de datos). La ejecuta el workflow
 * `biodiversidad-actualizar.yml` dentro del contenedor del backend:
 *
 *   node scripts/biodiversidad/actualizar.js pendientes                 imprime [{id, tarea}] (crea las programadas que tocan)
 *   node scripts/biodiversidad/actualizar.js iniciar <id>               marca la ejecución «en curso»
 *   node scripts/biodiversidad/actualizar.js registrar <id> <ok|error|omitida> [mensaje]
 *   node scripts/biodiversidad/actualizar.js frescura <id> <archivo.json>   registra la medición de frescura_gbif.mjs
 *
 * No habla con GBIF: lo que se baja de internet lo hacen procesos aparte, sin credenciales de base de datos.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import pool from '../../src/config/database.js';
import * as servicio from '../../src/modules/biodiversidad/actualizacion/actualizacion.service.js';

const ID = /^[0-9]{1,18}$/;

function idValido(texto) {
  if (!ID.test(texto ?? '')) throw new Error('Identificador de ejecución inválido');
  return texto;
}

export async function main([orden, ...resto]) {
  const salida = (obj) => process.stdout.write(`${JSON.stringify(obj)}\n`);
  if (orden === 'pendientes') {
    const lista = await servicio.pendientes();
    // --lineas: «<id> <tarea>» por línea, para recorrerlo con un `while read` en el shell del workflow.
    if (resto.includes('--lineas')) process.stdout.write(lista.map((p) => `${p.id} ${p.tarea}\n`).join(''));
    else salida(lista);
  } else if (orden === 'iniciar') {
    salida(await servicio.iniciar(idValido(resto[0])));
  } else if (orden === 'registrar') {
    const mensaje = resto.slice(2).join(' ').slice(0, 500);
    salida(await servicio.registrar(idValido(resto[0]), resto[1], mensaje ? { mensaje } : {}));
  } else if (orden === 'frescura') {
    const medicion = JSON.parse(readFileSync(resto[1], 'utf8'));
    const calculo = servicio.calcularFrescura(medicion.grupos, await servicio.lineaBaseFrescura());
    salida(await servicio.registrar(idValido(resto[0]), 'ok', { generado: medicion.generado, ...calculo }));
  } else {
    throw new Error('Órdenes: pendientes | iniciar <id> | registrar <id> <ok|error|omitida> [mensaje] | frescura <id> <archivo.json>');
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main(process.argv.slice(2))
    .then(() => pool.end())
    .catch((err) => {
      process.stderr.write(`Error: ${err.message}\n`);
      return pool.end().finally(() => process.exit(1));
    });
}
