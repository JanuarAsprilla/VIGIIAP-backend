/**
 * Tests de integración — cargador de biodiversidad contra PostgreSQL real.
 * Lo que importa y no se valida con mocks: que la carga sea atómica, idempotente, escriba solo
 * con el rol aislado y que activar un corte reemplace al anterior sin tocar el resto de Vigía.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { gzipSync } from 'zlib';
import { query } from '../../src/config/database.js';
import { cargarDatos, cambiarHerramienta, estadoCarga } from '../../scripts/biodiversidad/cargar.js';

const CLASIF = 'bb';
const TERR = 't1';

function lineas({ huella = 'h1', amenazada = true, conteoRegistro = 3 } = {}) {
  const d = [
    ['clasificacion', { clave: CLASIF, nombre: 'GBIF Backbone' }],
    ['territorio_version', { huella: TERR, origen: 'region/municipios.geojson' }],
    ['municipio', { territorio_huella: TERR, codigo: '27001', nombre: 'Quibdó', departamento: 'Chocó' }],
    ['municipio', { territorio_huella: TERR, codigo: '05045', nombre: 'Apartadó', departamento: 'Antioquia' }],
    ['entidad', { clave: 'e1', nombre: 'IIAP', metadatos: { sigla: 'IIAP' }, consultado_en: '2026-10-22T12:00:00Z' }],
    ['conjunto', { clave: 'ds1', titulo: 'Conjunto', entidad_clave: 'e1', doi: '10.1/x', licencia: 'CC_BY_4_0', metadatos: {}, consultado_en: '2026-10-22T12:00:00Z' }],
    ['lote', { ref: 1, grupo: 'anfibios', metodo: 'individual', clasificacion_clave: CLASIF, territorio_huella: TERR, desde: 2000, hasta: 2025, huella_fuente: huella, origen: 'gbif-api', doi: null, creado_en: '2026-10-20T10:00:00Z', fecha_fuente: '2026-10-20T09:00:00Z', registros: 3 }],
    ['lote', { ref: 2, grupo: 'aves', metodo: 'agregado', clasificacion_clave: CLASIF, territorio_huella: TERR, desde: 2000, hasta: 2025, huella_fuente: huella + 'a', origen: 'gbif-api', doi: null, creado_en: '2026-10-20T10:00:00Z', fecha_fuente: null, registros: 500 }],
    ['taxon_version', { huella: 'tx1', clasificacion_clave: CLASIF, taxon_clave: '1', rango: 'SPECIES', nombre_cientifico: 'Especie amenazada', especie_clave: '1', especie: 'Especie amenazada', linaje: { reino: 'Animalia' } }],
    ['taxon_version', { huella: 'tx2', clasificacion_clave: CLASIF, taxon_clave: '2', rango: 'SPECIES', nombre_cientifico: 'Especie común', especie_clave: '2', especie: 'Especie común', linaje: {} }],
    ['registro', { lote: 1, gbif_id: 'g1', dataset_key: 'ds1', taxon_huella: 'tx1', anio: 2020, latitud: 5.69, longitud: -76.65, incertidumbre_m: 30, tipo_evidencia: 'HUMAN_OBSERVATION', licencia: 'CC_BY_4_0', vista_1000m: true }],
    ['registro', { lote: 1, gbif_id: 'g2', dataset_key: 'ds1', taxon_huella: 'tx2', anio: 2021, latitud: 5.7, longitud: -76.6, incertidumbre_m: 10, vista_1000m: true }],
    ['registro', { lote: 1, gbif_id: 'g3', dataset_key: 'ds1', taxon_huella: 'tx2', anio: 2015, latitud: 7.88, longitud: -76.63, vista_1000m: false }],
    ['asignacion', { lote: 1, gbif_id: 'g1', territorio_huella: TERR, codigo: '27001' }],
    ['asignacion', { lote: 1, gbif_id: 'g2', territorio_huella: TERR, codigo: '27001' }],
    ['asignacion', { lote: 1, gbif_id: 'g3', territorio_huella: TERR, codigo: '05045' }],
    ['resumen_territorial', { lote: 1, territorio_huella: TERR, codigo: '27001', registros: 2, sin_especie: 0 }],
    ['resumen_territorial', { lote: 2, territorio_huella: TERR, codigo: '27001', registros: 500, sin_especie: 3 }],
    ['inventario_especie', { lote: 2, codigo: '27001', taxon_huella: 'tx2', registros: 400 }],
    ['conteo_fuente', { lote: 2, codigo: '27001', dataset_key: 'ds1', registros: 500 }],
    ['faceta_municipal', { lote: 2, codigo: '27001', faceta: 'anio', valor: '2020', registros: 300 }],
    ['conservacion_importacion', { ref: 7, creado_en: '2026-10-20T18:19:56Z', huella: 'c-' + huella, informe: { lotes: [] } }],
    ['conservacion_fuente', { importacion: 7, slug: 'amenaza_colombia', metadatos: { doi: '10.15472/frowz3' } }],
    ['conservacion_afirmacion', { ref: 70, importacion: 7, fuente: 'amenaza_colombia', id_original: 'a1', nombre: 'Especie amenazada', reino: 'Animalia', rango: 'SPECIES', tema: 'amenaza_nacional', valor: amenazada ? 'CR' : 'LC', campo: 'categoria', original: { x: 1 }, motivo_revision: null }],
    ['conservacion_vinculo', { afirmacion: 70, clasificacion_clave: CLASIF, especie_clave: '1', metodo: 'nombre_exacto' }],
  ];
  const conteos = {};
  for (const [t] of d) conteos[t] = (conteos[t] ?? 0) + 1;
  conteos.registro = conteoRegistro;
  return [['manifiesto', { formato: 1, generado: '2026-10-30T00:00:00Z', fuente_sha256: 'x', conteos }], ...d]
    .map(([t, fila]) => JSON.stringify({ t, d: fila }));
}

let carpeta;
function archivo(texto) {
  const ruta = join(carpeta, `datos-${Math.random().toString(36).slice(2)}.ndjson.gz`);
  writeFileSync(ruta, gzipSync(texto));
  return ruta;
}
const cuerpo = (opts) => lineas(opts).join('\n') + '\n';
const contar = async (tabla) => (await query(`SELECT count(*)::int AS n FROM biodiversidad.${tabla}`)).rows[0].n;

async function limpiar() {
  await query(`TRUNCATE biodiversidad.clasificacion, biodiversidad.territorio_version, biodiversidad.entidad,
    biodiversidad.conjunto, biodiversidad.conservacion_importacion RESTART IDENTITY CASCADE`);
  await query(`UPDATE herramientas SET activa = false, visibilidad = 'publico' WHERE clave = 'biodiversidad'`);
}

beforeEach(async () => { carpeta = mkdtempSync(join(tmpdir(), 'bio-')); await limpiar(); });
afterEach(async () => { rmSync(carpeta, { recursive: true, force: true }); await limpiar(); });

describe('cargarDatos()', () => {
  it('carga todas las tablas y reporta lo leído y lo insertado', async () => {
    const r = await cargarDatos(archivo(cuerpo()));
    expect(r.tablas.registro).toMatchObject({ leidas: 3, insertadas: 3 });
    expect(r.tablas.lote.leidas).toBe(2);
    expect(await contar('registro')).toBe(3);
    expect(await contar('asignacion')).toBe(3);
    expect(await contar('municipio')).toBe(2);
    expect(await contar('conservacion_vinculo')).toBe(1);
    expect(r.omitidos).toEqual({ lotes: 0, cruces: 0 });
  });

  it('sin activar deja lotes y cruce inactivos (las coordenadas quedan ocultas)', async () => {
    await cargarDatos(archivo(cuerpo()));
    expect((await query('SELECT count(*)::int AS n FROM biodiversidad.lote WHERE activo')).rows[0].n).toBe(0);
    expect((await query('SELECT count(*)::int AS n FROM biodiversidad.conservacion_importacion WHERE activo')).rows[0].n).toBe(0);
    const { rows } = await query('SELECT count(*)::int AS n FROM biodiversidad.vw_registro_publico');
    expect(rows[0].n).toBe(0);
  });

  it('con activar publica los cortes y la vista pública oculta solo la especie amenazada', async () => {
    await cargarDatos(archivo(cuerpo()), { activar: true });
    const { rows } = await query(
      'SELECT gbif_id, latitud, coordenadas_ocultas FROM biodiversidad.vw_registro_publico ORDER BY gbif_id');
    expect(rows).toEqual([
      { gbif_id: 'g1', latitud: null, coordenadas_ocultas: true },
      { gbif_id: 'g2', latitud: 5.7, coordenadas_ocultas: false },
      { gbif_id: 'g3', latitud: 7.88, coordenadas_ocultas: false },
    ]);
  });

  it('es idempotente: cargar el mismo archivo dos veces no duplica nada', async () => {
    await cargarDatos(archivo(cuerpo()));
    const r2 = await cargarDatos(archivo(cuerpo()));
    expect(r2.omitidos).toEqual({ lotes: 2, cruces: 1 });
    expect(await contar('registro')).toBe(3);
    expect(await contar('lote')).toBe(2);
    expect(await contar('conservacion_afirmacion')).toBe(1);
  });

  it('es atómico: si el manifiesto no coincide con lo leído no queda nada cargado', async () => {
    await expect(cargarDatos(archivo(cuerpo({ conteoRegistro: 99 })))).rejects.toThrow(/registro/);
    expect(await contar('registro')).toBe(0);
    expect(await contar('lote')).toBe(0);
    expect(await contar('municipio')).toBe(0);
  });

  it('es atómico ante una línea corrupta', async () => {
    const roto = cuerpo() + '{esto no es json\n';
    await expect(cargarDatos(archivo(roto))).rejects.toThrow(/línea/i);
    expect(await contar('registro')).toBe(0);
  });

  it('rechaza tablas que no estén en la lista permitida', async () => {
    const malo = cuerpo() + JSON.stringify({ t: 'usuarios', d: { email: 'x@y.z' } }) + '\n';
    await expect(cargarDatos(archivo(malo))).rejects.toThrow(/usuarios/);
    expect(await contar('registro')).toBe(0);
  });

  it('rechaza un archivo sin manifiesto al inicio', async () => {
    const sin = lineas().slice(1).join('\n') + '\n';
    await expect(cargarDatos(archivo(sin))).rejects.toThrow(/manifiesto/i);
  });

  it('escribe con el rol aislado: no toca usuarios ni herramientas', async () => {
    const antes = (await query('SELECT count(*)::int AS n FROM usuarios')).rows[0].n;
    await cargarDatos(archivo(cuerpo()), { activar: true });
    expect((await query('SELECT count(*)::int AS n FROM usuarios')).rows[0].n).toBe(antes);
    expect((await query(`SELECT activa FROM herramientas WHERE clave = 'biodiversidad'`)).rows[0].activa).toBe(false);
  });

  it('activar un corte nuevo del mismo grupo desactiva el anterior', async () => {
    await cargarDatos(archivo(cuerpo({ huella: 'h1' })), { activar: true });
    await cargarDatos(archivo(cuerpo({ huella: 'h2' })), { activar: true });
    const { rows } = await query(
      `SELECT huella_fuente, activo FROM biodiversidad.lote WHERE grupo = 'anfibios' ORDER BY id`);
    expect(rows).toEqual([{ huella_fuente: 'h1', activo: false }, { huella_fuente: 'h2', activo: true }]);
    const { rows: cruces } = await query('SELECT huella, activo FROM biodiversidad.conservacion_importacion ORDER BY id');
    expect(cruces).toEqual([{ huella: 'c-h1', activo: false }, { huella: 'c-h2', activo: true }]);
  });
});

describe('estadoCarga() y cambiarHerramienta()', () => {
  it('resume lotes, cruce y estado de la herramienta', async () => {
    await cargarDatos(archivo(cuerpo()), { activar: true });
    const e = await estadoCarga();
    expect(e.lotes.map((l) => [l.grupo, l.activo, l.registros_cargados])).toEqual([['anfibios', true, 3], ['aves', true, 0]]);
    expect(e.cruce_activo).toBe(true);
    expect(e.herramienta).toMatchObject({ clave: 'biodiversidad', activa: false });
  });

  it('enciende y apaga solo la fila de la herramienta', async () => {
    expect(await cambiarHerramienta(true)).toMatchObject({ activa: true });
    expect((await query(`SELECT activa FROM herramientas WHERE clave = 'biodiversidad'`)).rows[0].activa).toBe(true);
    expect(await cambiarHerramienta(false)).toMatchObject({ activa: false });
  });

  it('falla claro si la fila de la herramienta no existe', async () => {
    await query(`UPDATE herramientas SET deleted_at = NOW() WHERE clave = 'biodiversidad'`);
    try {
      await expect(cambiarHerramienta(true)).rejects.toThrow(/biodiversidad/);
    } finally {
      await query(`UPDATE herramientas SET deleted_at = NULL WHERE clave = 'biodiversidad'`);
    }
  });
});
