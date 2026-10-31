/**
 * Cargador de datos de biodiversidad. Lee el archivo NDJSON comprimido que genera
 * exportar_desde_sqlite.py y lo inserta en el esquema `biodiversidad`.
 *
 *   node scripts/biodiversidad/cargar.js cargar <archivo.ndjson.gz> [--activar]
 *   node scripts/biodiversidad/cargar.js estado
 *   node scripts/biodiversidad/cargar.js encender | apagar     (fila `biodiversidad` de Herramientas)
 *
 * Garantías: todo ocurre en UNA transacción (si algo falla no queda nada), escribe con el rol
 * aislado `biodiversidad_ingesta` (no puede tocar usuarios ni tokens), el archivo no decide qué
 * tablas ni columnas se escriben, y es idempotente (un corte ya cargado se omite).
 */
import { createReadStream } from 'fs';
import { createGunzip } from 'zlib';
import { createInterface } from 'readline';
import { fileURLToPath } from 'url';
import pool, { getClient, query } from '../../src/config/database.js';
import { codigosGbif } from '../../src/modules/biodiversidad/consultas/marcas.js';
import { invalidateCache } from '../../src/middlewares/cache.js';

const ROL_INGESTA = 'biodiversidad_ingesta';
const TAMANO_LOTE = 2000;
const CLAVE_HERRAMIENTA = 'biodiversidad';

// Tablas permitidas y columnas que se insertan. El archivo nunca amplía esta lista.
const DIMENSIONES = {
  clasificacion: ['clave', 'nombre'],
  territorio_version: ['huella', 'origen'],
  municipio: ['territorio_huella', 'codigo', 'nombre', 'departamento'],
  entidad: ['clave', 'nombre', 'metadatos', 'consultado_en'],
  conjunto: ['clave', 'titulo', 'entidad_clave', 'doi', 'licencia', 'metadatos', 'consultado_en'],
  taxon_version: [
    'huella', 'clasificacion_clave', 'taxon_clave', 'rango', 'nombre_cientifico', 'estado_taxonomico', 'aceptado_clave',
    'reino_clave', 'reino', 'division_clave', 'division', 'clase_clave', 'clase', 'orden_clave', 'orden',
    'familia_clave', 'familia', 'genero_clave', 'genero', 'especie_clave', 'especie', 'linaje',
  ],
};
const DE_LOTE = {
  registro: [
    'lote_id', 'gbif_id', 'dataset_key', 'taxon_huella', 'occurrence_id', 'fecha_evento', 'anio', 'latitud', 'longitud',
    'incertidumbre_m', 'tipo_evidencia', 'licencia', 'institution_code', 'collection_code', 'catalog_number',
    'nombre_original', 'last_interpreted', 'modified', 'marcas_revision', 'vista_1000m',
  ],
  registro_detalle: ['lote_id', 'gbif_id', 'registrado_por', 'identificado_por', 'fotos', 'marcas_gbif'],
  asignacion: ['lote_id', 'gbif_id', 'territorio_huella', 'codigo'],
  resumen_territorial: ['lote_id', 'territorio_huella', 'codigo', 'registros', 'sin_especie'],
  inventario_especie: ['lote_id', 'codigo', 'taxon_huella', 'registros'],
  conteo_fuente: ['lote_id', 'codigo', 'dataset_key', 'registros'],
  faceta_municipal: ['lote_id', 'codigo', 'faceta', 'valor', 'registros'],
};
// Tablas que se completan SOBRE un corte ya cargado (lote «omitido»): los cortes publicados antes de
// que existiera el detalle reciben sus filas nuevas sin repetir el resto; lo ya cargado no se pisa.
const COMPLEMENTOS = new Set(['registro_detalle']);
const COLUMNAS_LOTE = [
  'grupo', 'metodo', 'clasificacion_clave', 'territorio_huella', 'desde', 'hasta', 'huella_fuente', 'origen', 'doi',
  'creado_en', 'fecha_fuente', 'registros',
];
const COLUMNAS_AFIRMACION = [
  'fuente', 'id_original', 'nombre', 'reino', 'rango', 'tema', 'valor', 'campo', 'original', 'motivo_revision',
];
const PERMITIDAS = new Set([
  ...Object.keys(DIMENSIONES), ...Object.keys(DE_LOTE), 'lote',
  'conservacion_importacion', 'conservacion_fuente', 'conservacion_afirmacion', 'conservacion_vinculo',
]);

async function insertarEnLote(client, tabla, columnas, filas, ignorarConflicto) {
  if (filas.length === 0) return 0;
  const lista = columnas.join(', ');
  const { rowCount } = await client.query(
    `INSERT INTO biodiversidad.${tabla} (${lista})
     SELECT ${lista} FROM jsonb_populate_recordset(NULL::biodiversidad.${tabla}, $1::jsonb)
     ${ignorarConflicto ? 'ON CONFLICT DO NOTHING' : ''}`,
    [JSON.stringify(filas)],
  );
  return rowCount;
}

function abrirLineas(ruta) {
  const entrada = createReadStream(ruta);
  const gz = createGunzip();
  entrada.on('error', (e) => gz.destroy(e));
  entrada.pipe(gz);
  return createInterface({ input: gz, crlfDelay: Infinity });
}

async function procesar(client, ruta) {
  const leidas = {};
  const insertadas = {};
  const lotes = new Map(); // ref -> { id, grupo, metodo, omitido }
  const cruces = new Map(); // ref -> { id, omitido }
  const afirmaciones = new Map(); // ref -> id
  let manifiesto = null;
  let pendiente = { tabla: null, columnas: null, filas: [], ignorar: false };

  const vaciar = async () => {
    if (pendiente.filas.length > 0) {
      const n = await insertarEnLote(client, pendiente.tabla, pendiente.columnas, pendiente.filas, pendiente.ignorar);
      insertadas[pendiente.tabla] = (insertadas[pendiente.tabla] ?? 0) + n;
    }
    pendiente = { tabla: null, columnas: null, filas: [], ignorar: false };
  };
  const encolar = async (tabla, columnas, fila, ignorar) => {
    if (pendiente.tabla !== tabla) await vaciar();
    pendiente.tabla = tabla;
    pendiente.columnas = columnas;
    pendiente.ignorar = ignorar;
    pendiente.filas.push(fila);
    if (pendiente.filas.length >= TAMANO_LOTE) await vaciar();
  };
  const sumar = (mapa, tabla, n = 1) => { mapa[tabla] = (mapa[tabla] ?? 0) + n; };

  let numero = 0;
  for await (const linea of abrirLineas(ruta)) {
    numero += 1;
    if (!linea.trim()) continue;
    let obj;
    try {
      obj = JSON.parse(linea);
    } catch {
      throw new Error(`Línea ${numero} inválida: no es JSON`);
    }
    const { t, d } = obj;
    if (manifiesto === null) {
      if (t !== 'manifiesto' || !d?.conteos) throw new Error('El archivo debe empezar con el manifiesto');
      manifiesto = d;
      continue;
    }
    if (!PERMITIDAS.has(t)) throw new Error(`Tabla no permitida en el archivo: ${t}`);
    sumar(leidas, t);

    if (t in DIMENSIONES) {
      await encolar(t, DIMENSIONES[t], d, true);
    } else if (t === 'lote') {
      await vaciar();
      const valores = COLUMNAS_LOTE.map((c) => d[c] ?? null);
      const { rows } = await client.query(
        `INSERT INTO biodiversidad.lote (${COLUMNAS_LOTE.join(', ')}, estado, activo)
         VALUES (${COLUMNAS_LOTE.map((_, i) => `$${i + 1}`).join(', ')}, 'completo', false)
         ON CONFLICT (grupo, metodo, clasificacion_clave, territorio_huella, desde, hasta, huella_fuente) DO NOTHING
         RETURNING id`,
        valores,
      );
      if (rows.length > 0) {
        lotes.set(d.ref, { id: rows[0].id, grupo: d.grupo, metodo: d.metodo, omitido: false });
        sumar(insertadas, 'lote');
      } else {
        const { rows: [existente] } = await client.query(
          `SELECT id FROM biodiversidad.lote WHERE grupo = $1 AND metodo = $2 AND clasificacion_clave = $3
              AND territorio_huella = $4 AND desde = $5 AND hasta = $6 AND huella_fuente = $7`,
          [d.grupo, d.metodo, d.clasificacion_clave, d.territorio_huella, d.desde, d.hasta, d.huella_fuente]);
        lotes.set(d.ref, { id: existente.id, grupo: d.grupo, metodo: d.metodo, omitido: true });
      }
    } else if (t in DE_LOTE) {
      const lote = lotes.get(d.lote);
      if (!lote) throw new Error(`Línea ${numero}: ${t} apunta a un lote desconocido (${d.lote})`);
      const complemento = COMPLEMENTOS.has(t);
      if (lote.omitido && !complemento) continue;
      const { lote: _ref, ...resto } = d;
      // Un archivo de un formato anterior puede no traer fotos o marcas: se cargan vacías, no nulas.
      const porDefecto = t === 'registro_detalle' ? { fotos: resto.fotos ?? [], marcas_gbif: codigosGbif(resto.marcas_gbif) } : {};
      await encolar(t, DE_LOTE[t], { ...resto, ...porDefecto, lote_id: lote.id }, complemento);
    } else if (t === 'conservacion_importacion') {
      await vaciar();
      const { rows } = await client.query(
        `INSERT INTO biodiversidad.conservacion_importacion (creado_en, huella, activo, informe)
         VALUES ($1, $2, false, $3::jsonb) ON CONFLICT (huella) DO NOTHING RETURNING id`,
        [d.creado_en, d.huella, JSON.stringify(d.informe ?? {})]);
      if (rows.length > 0) {
        cruces.set(d.ref, { id: rows[0].id, omitido: false });
        sumar(insertadas, t);
      } else {
        const { rows: [existente] } = await client.query(
          'SELECT id FROM biodiversidad.conservacion_importacion WHERE huella = $1', [d.huella]);
        cruces.set(d.ref, { id: existente.id, omitido: true });
      }
    } else if (t === 'conservacion_fuente') {
      const cruce = cruces.get(d.importacion);
      if (!cruce) throw new Error(`Línea ${numero}: conservacion_fuente apunta a un cruce desconocido`);
      if (cruce.omitido) continue;
      await encolar(t, ['importacion_id', 'slug', 'metadatos'],
        { importacion_id: cruce.id, slug: d.slug, metadatos: d.metadatos }, false);
    } else if (t === 'conservacion_afirmacion') {
      await vaciar();
      const cruce = cruces.get(d.importacion);
      if (!cruce) throw new Error(`Línea ${numero}: conservacion_afirmacion apunta a un cruce desconocido`);
      if (cruce.omitido) continue;
      const { rows } = await client.query(
        `INSERT INTO biodiversidad.conservacion_afirmacion (importacion_id, ${COLUMNAS_AFIRMACION.join(', ')})
         VALUES ($1, ${COLUMNAS_AFIRMACION.map((c, i) => (c === 'original' ? `$${i + 2}::jsonb` : `$${i + 2}`)).join(', ')})
         RETURNING id`,
        [cruce.id, ...COLUMNAS_AFIRMACION.map((c) => (c === 'original' ? JSON.stringify(d.original ?? {}) : d[c] ?? null))]);
      afirmaciones.set(d.ref, rows[0].id);
      sumar(insertadas, t);
    } else if (t === 'conservacion_vinculo') {
      const afirmacionId = afirmaciones.get(d.afirmacion);
      if (afirmacionId === undefined) continue; // su cruce ya estaba cargado
      await encolar(t, ['afirmacion_id', 'clasificacion_clave', 'especie_clave', 'metodo'],
        { afirmacion_id: afirmacionId, clasificacion_clave: d.clasificacion_clave, especie_clave: d.especie_clave, metodo: d.metodo },
        false);
    }
  }
  await vaciar();

  if (manifiesto === null) throw new Error('El archivo está vacío: falta el manifiesto');
  for (const [tabla, esperado] of Object.entries(manifiesto.conteos)) {
    if ((leidas[tabla] ?? 0) !== esperado) {
      throw new Error(`El manifiesto declara ${esperado} filas de ${tabla} y se leyeron ${leidas[tabla] ?? 0}`);
    }
  }
  for (const lote of lotes.values()) {
    if (lote.omitido || lote.metodo !== 'individual') continue;
    const { rows: [r] } = await client.query(
      `SELECT l.registros::int AS declarados, (SELECT count(*)::int FROM biodiversidad.registro WHERE lote_id = l.id) AS cargados
         FROM biodiversidad.lote l WHERE l.id = $1`, [lote.id]);
    if (r.declarados !== r.cargados) {
      throw new Error(`El corte ${lote.grupo} declara ${r.declarados} registros y se cargaron ${r.cargados}`);
    }
  }

  const todosLotes = [...lotes.values()];
  return {
    tablas: Object.fromEntries(Object.keys(leidas).map((t) => [t, { leidas: leidas[t], insertadas: insertadas[t] ?? 0 }])),
    omitidos: { lotes: todosLotes.filter((l) => l.omitido).length, cruces: [...cruces.values()].filter((c) => c.omitido).length },
    lotes: todosLotes,
    cruces: [...cruces.values()],
  };
}

/** Publica los cortes del archivo: reemplaza al corte activo del mismo grupo y al cruce activo anterior. */
async function activarCortes(client, lotes, cruces) {
  for (const { id, grupo } of lotes) {
    await client.query('UPDATE biodiversidad.lote SET activo = false WHERE grupo = $1 AND activo AND id <> $2', [grupo, id]);
    await client.query('UPDATE biodiversidad.lote SET activo = true WHERE id = $1', [id]);
  }
  for (const { id } of cruces) {
    await client.query('UPDATE biodiversidad.conservacion_importacion SET activo = false WHERE activo AND id <> $1', [id]);
    await client.query('UPDATE biodiversidad.conservacion_importacion SET activo = true WHERE id = $1', [id]);
  }
}

export async function cargarDatos(ruta, { activar = false } = {}) {
  const client = await getClient();
  try {
    await client.query('BEGIN');
    await client.query(`SET LOCAL ROLE ${ROL_INGESTA}`);
    const resumen = await procesar(client, ruta);
    if (activar) {
      await client.query('RESET ROLE'); // activar toca lote/cruce como dueño; el resto de la carga fue con el rol aislado
      await activarCortes(client, resumen.lotes, resumen.cruces);
    }
    await client.query('COMMIT');
    const { lotes, cruces, ...publico } = resumen;
    return { ...publico, activado: activar };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

export async function estadoCarga() {
  const { rows: lotes } = await query(
    `SELECT l.grupo, l.metodo, l.activo, l.desde, l.hasta, l.registros::int AS registros_declarados,
            (SELECT count(*)::int FROM biodiversidad.registro r WHERE r.lote_id = l.id) AS registros_cargados
       FROM biodiversidad.lote l ORDER BY l.id`);
  const { rows: [cruce] } = await query(
    'SELECT EXISTS (SELECT 1 FROM biodiversidad.conservacion_importacion WHERE activo) AS activo');
  const { rows: [herramienta] } = await query(
    'SELECT clave, activa, visibilidad FROM herramientas WHERE clave = $1 AND deleted_at IS NULL', [CLAVE_HERRAMIENTA]);
  return { lotes, cruce_activo: cruce.activo, herramienta: herramienta ?? null };
}

/** Enciende o apaga la fila de la herramienta (el interruptor que usa la API y la interfaz). */
export async function cambiarHerramienta(encendida) {
  const { rows } = await query(
    `UPDATE herramientas SET activa = $2, actualizado_en = NOW()
      WHERE clave = $1 AND deleted_at IS NULL RETURNING clave, activa, visibilidad`,
    [CLAVE_HERRAMIENTA, encendida]);
  if (rows.length === 0) throw new Error(`No existe la herramienta ${CLAVE_HERRAMIENTA} en el catálogo`);
  // El listado público de Herramientas está en cache: sin esto el cambio tardaría minutos en verse.
  await Promise.all(['cache:/api/herramientas*', 'cache:/api/v1/herramientas*'].map((p) => invalidateCache(p).catch(() => {})));
  return rows[0];
}

async function main(argumentos) {
  const [orden, ...resto] = argumentos;
  const salida = (obj) => process.stdout.write(`${JSON.stringify(obj, null, 2)}\n`);
  if (orden === 'cargar') {
    const ruta = resto.find((a) => !a.startsWith('--'));
    if (!ruta) throw new Error('Uso: cargar <archivo.ndjson.gz> [--activar]');
    salida(await cargarDatos(ruta, { activar: resto.includes('--activar') }));
  } else if (orden === 'estado') {
    salida(await estadoCarga());
  } else if (orden === 'encender' || orden === 'apagar') {
    salida(await cambiarHerramienta(orden === 'encender'));
  } else {
    throw new Error('Órdenes: cargar <archivo> [--activar] | estado | encender | apagar');
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
