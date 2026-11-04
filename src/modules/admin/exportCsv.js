/**
 * exportCsv.js — CSV de administración: formato de celdas y transmisión por bloques.
 * Sin dependencias externas (ver export.controller.js sobre los CVEs de librerías de hojas de cálculo).
 */
import { query } from '../../config/database.js';
import logger from '../../utils/logger.js';

/** Tope de filas de un CSV: protege a la base y al navegador, no a la memoria del servidor (se transmite). */
export const MAX_FILAS_CSV = 500_000;
const TAMANO_BLOQUE = 2_000;

/** Escapa una celda. Neutraliza la inyección de fórmulas: =, +, -, @, TAB y CR al inicio se prefijan con '. */
export function celdaCsv(valor) {
  if (valor === null || valor === undefined) return '';
  let s = String(valor);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return s.includes(',') || s.includes('"') || s.includes('\n') || s.startsWith("'")
    ? `"${s.replace(/"/g, '""')}"`
    : s;
}

export const lineaCsv = (valores) => valores.map(celdaCsv).join(',');

function esperarDrenaje(res) {
  return new Promise((resolver) => {
    const listo = () => {
      res.off?.('drain', listo);
      res.off?.('close', listo);
      resolver();
    };
    res.once('drain', listo);
    res.once('close', listo);
  });
}

function interrumpida(res) {
  return res.destroyed === true || res.writableEnded === true;
}

/**
 * Transmite como CSV el resultado de una consulta sin cargarlo entero en memoria: lo lee en bloques
 * por llave (fecha, id) —consultas parametrizadas, con desempate por id para no saltar ni repetir
 * filas que comparten fecha— y respeta la contrapresión de la conexión.
 *
 * `tabla`, `columnas` y `columnaFecha` los define siempre el código del servidor, nunca el cliente;
 * lo que viene del cliente entra solo por `params` en `condiciones`.
 *
 * Si hay más de `maxFilas` coincidencias responde 400 antes de enviar nada y devuelve null.
 * Devuelve `{ filas }` al terminar. Si falla a mitad, la conexión se corta para que el cliente vea
 * la descarga fallida en lugar de un archivo truncado que parezca completo.
 */
export async function transmitirCsv({
  res, nombreArchivo, tabla, columnas, columnaFecha, condiciones = [], params = [],
  excluir = new Set(), alIniciar, maxFilas = MAX_FILAS_CSV, tamanoBloque = TAMANO_BLOQUE,
}) {
  const donde = (extra = []) => {
    const todas = [...condiciones, ...extra];
    return todas.length ? `WHERE ${todas.join(' AND ')}` : '';
  };

  const { rows: [{ total }] } = await query(`SELECT COUNT(*)::int AS total FROM ${tabla} ${donde()}`, params);
  if (total > maxFilas) {
    res.status(400).json({ error: `Más de ${maxFilas} registros. Reduce el rango de fechas.` });
    return null;
  }
  alIniciar?.(total);

  // Los encabezados y el BOM salen recién con el primer bloque: si la base falla antes, el cliente
  // recibe un error normal y no una descarga que ya empezó.
  let iniciada = false;
  const iniciar = () => {
    if (iniciada) return;
    iniciada = true;
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${nombreArchivo}.csv"`);
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Accel-Buffering', 'no'); // que nginx no acumule el archivo entero antes de enviarlo
    res.write('﻿'); // BOM para compatibilidad con Excel
  };

  try {
    let cursor = null;
    let cabecera = null;
    let filas = 0;

    while (filas < maxFilas && !interrumpida(res)) {
      const parametros = [...params];
      const extra = [];
      if (cursor) {
        parametros.push(cursor.fecha, cursor.id);
        extra.push(`(${columnaFecha}, id) < ($${parametros.length - 1}::timestamptz, $${parametros.length})`);
      }
      parametros.push(Math.min(tamanoBloque, maxFilas - filas));
      const { rows } = await query(
        `SELECT ${columnas}, ${columnaFecha}::text AS _cursor FROM ${tabla} ${donde(extra)}
         ORDER BY ${columnaFecha} DESC, id DESC LIMIT $${parametros.length}`,
        parametros,
      );
      if (!rows.length) break;

      iniciar();
      if (!cabecera) {
        cabecera = Object.keys(rows[0]).filter((c) => c !== '_cursor' && !excluir.has(c));
        res.write(`${lineaCsv(cabecera)}\r\n`);
      }
      const bloque = rows.map((r) => `${lineaCsv(cabecera.map((c) => r[c]))}\r\n`).join('');
      filas += rows.length;
      if (!res.write(bloque)) await esperarDrenaje(res);

      const ultima = rows[rows.length - 1];
      cursor = { fecha: ultima._cursor, id: ultima.id };
      if (rows.length < tamanoBloque) break;
    }
    iniciar(); // sin filas: archivo vacío (solo el BOM), igual que antes
    if (!interrumpida(res)) res.end();
    return { filas };
  } catch (err) {
    if (!iniciada) throw err;
    logger.error(`[export] Falló la transmisión de ${nombreArchivo}.csv: ${err.message}`);
    res.destroy(err);
    return null;
  }
}
