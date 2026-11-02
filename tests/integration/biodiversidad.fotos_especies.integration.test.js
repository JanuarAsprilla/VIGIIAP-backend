/**
 * Cargador de fotos por especie (grupos agregados) contra PostgreSQL real: solo entra lo válido, repetir la
 * carga no duplica y la última línea de una especie repetida gana.
 */
import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { gzipSync } from 'zlib';
import { query } from '../../src/config/database.js';
import { cargarFotosEspecies } from '../../scripts/biodiversidad/cargar_fotos_especies.js';

const dir = mkdtempSync(join(tmpdir(), 'fotos-especies-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const img = (n) => `https://api.gbif.org/v1/image/cache/400x/occurrence/${n}/media/${'ab'.repeat(16)}`;
const fila = (clave, n, extra = {}) => ({
  especie_clave: clave, imagen: img(n), autor: 'Ana', editor: 'iNaturalist', licencia: 'CC-BY', referencia: `https://www.inaturalist.org/photos/${n}`, ...extra,
});
const archivo = (nombre, lineas, gz = false) => {
  const ruta = join(dir, nombre);
  const texto = `${lineas.map((l) => (typeof l === 'string' ? l : JSON.stringify(l))).join('\n')}\n`;
  writeFileSync(ruta, gz ? gzipSync(texto) : texto);
  return ruta;
};

beforeEach(async () => { await query('TRUNCATE biodiversidad.especie_foto'); });

describe('cargarFotosEspecies()', () => {
  it('carga las válidas y descarta las inválidas, contándolas', async () => {
    const ruta = archivo('a.ndjson', [
      fila('1', 1), fila('2', 2),
      fila('3', 3, { imagen: 'https://inaturalist-open-data.s3.amazonaws.com/photos/3/original.jpeg' }),
      fila('4', 4, { referencia: 'http://x.org/' }),
      'esto no es json',
    ]);
    expect(await cargarFotosEspecies(ruta)).toEqual({ leidas: 5, cargadas: 2, descartadas: 3 });
    const { rows } = await query('SELECT especie_clave FROM biodiversidad.especie_foto ORDER BY 1');
    expect(rows.map((r) => r.especie_clave)).toEqual(['1', '2']);
  });

  it('repetir la carga no duplica y actualiza; si una especie se repite, gana la última línea', async () => {
    await cargarFotosEspecies(archivo('b.ndjson', [fila('1', 1)]));
    await cargarFotosEspecies(archivo('c.ndjson', [fila('1', 10, { autor: 'Primero' }), fila('1', 11, { autor: 'Último' })]));
    const { rows } = await query('SELECT imagen, autor FROM biodiversidad.especie_foto');
    expect(rows).toEqual([{ imagen: img(11), autor: 'Último' }]);
  });

  it('lee archivos comprimidos (.gz)', async () => {
    expect(await cargarFotosEspecies(archivo('d.ndjson.gz', [fila('7', 7)], true))).toMatchObject({ cargadas: 1 });
  });

  it('un archivo sin líneas válidas no deja nada y no falla', async () => {
    expect(await cargarFotosEspecies(archivo('e.ndjson', ['{}']))).toEqual({ leidas: 1, cargadas: 0, descartadas: 1 });
    const { rows } = await query('SELECT count(*)::int AS n FROM biodiversidad.especie_foto');
    expect(rows[0].n).toBe(0);
  });
});
