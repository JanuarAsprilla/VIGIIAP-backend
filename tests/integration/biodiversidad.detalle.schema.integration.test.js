/**
 * Tests de integración — migración 064 (detalle de registros y conservación por especie).
 * Verifican contra PostgreSQL real: RLS y privilegios de la tabla nueva, que la vista pública
 * conserve el ocultamiento de coordenadas al ampliarse, la vista de conservación por especie,
 * la idempotencia y la reversión.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { query, getClient } from '../../src/config/database.js';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const MIGRACION = readFileSync(join(RAIZ, 'db/migrations/064_biodiversidad_detalle.sql'), 'utf8');
const REVERSION = readFileSync(join(RAIZ, 'db/rollback/064_biodiversidad_detalle.down.sql'), 'utf8');

const COLUMNAS_ORIGINALES = [
  'lote_id', 'grupo', 'gbif_id', 'dataset_key', 'taxon_huella', 'especie_clave', 'especie', 'anio', 'fecha_evento',
  'tipo_evidencia', 'licencia', 'latitud', 'longitud', 'incertidumbre_m', 'coordenadas_ocultas',
];
const COLUMNAS_NUEVAS = [
  'registrado_por', 'identificado_por', 'fotos', 'marcas_revision', 'institution_code', 'collection_code',
  'catalog_number', 'occurrence_id', 'nombre_original',
];

async function enTransaccion(fn) {
  const client = await getClient();
  try {
    await client.query('BEGIN');
    return await fn(client);
  } finally {
    await client.query('ROLLBACK');
    client.release();
  }
}

async function sembrar(client, { cruceActivo = true } = {}) {
  await client.query(`INSERT INTO biodiversidad.clasificacion VALUES ('bb', 'GBIF Backbone')`);
  await client.query(`INSERT INTO biodiversidad.territorio_version (huella, origen) VALUES ('t1', 'prueba')`);
  await client.query(`INSERT INTO biodiversidad.conjunto (clave, titulo, licencia) VALUES ('ds1', 'Conjunto', 'CC_BY_4_0')`);
  const { rows: [lote] } = await client.query(
    `INSERT INTO biodiversidad.lote (grupo, metodo, clasificacion_clave, territorio_huella, desde, hasta, huella_fuente, origen, registros, estado, activo)
     VALUES ('anfibios', 'individual', 'bb', 't1', 2000, 2025, 'h1', 'prueba', 3, 'completo', true) RETURNING id`);
  for (const [huella, clave, nombre] of [['tx1', '1', 'Especie amenazada'], ['tx2', '2', 'Especie común']]) {
    await client.query(
      `INSERT INTO biodiversidad.taxon_version (huella, clasificacion_clave, taxon_clave, rango, nombre_cientifico, especie_clave, especie, linaje)
       VALUES ($1, 'bb', $2, 'SPECIES', $3, $2, $3, '{}')`, [huella, clave, nombre]);
  }
  await client.query(
    `INSERT INTO biodiversidad.registro (lote_id, gbif_id, dataset_key, taxon_huella, anio, latitud, longitud, incertidumbre_m, vista_1000m, occurrence_id, marcas_revision)
     VALUES ($1, 'g1', 'ds1', 'tx1', 2020, 5.69, -76.65, 30, true, 'occ-1', 'a;b'),
            ($1, 'g2', 'ds1', 'tx2', 2021, 5.70, -76.60, 10, true, 'occ-2', ''),
            ($1, 'g3', 'ds1', 'tx2', 2022, 5.71, -76.61, 10, true, NULL, NULL)`, [lote.id]);
  await client.query(
    `INSERT INTO biodiversidad.registro_detalle (lote_id, gbif_id, registrado_por, identificado_por, fotos)
     VALUES ($1, 'g1', 'Ana', 'Beto', '[{"imagen":"x"}]'), ($1, 'g2', NULL, NULL, '[]')`, [lote.id]);
  if (cruceActivo) {
    const { rows: [imp] } = await client.query(
      `INSERT INTO biodiversidad.conservacion_importacion (huella, activo) VALUES ('c1', true) RETURNING id`);
    const afirmar = async (tema, valor, clave) => {
      const { rows: [af] } = await client.query(
        `INSERT INTO biodiversidad.conservacion_afirmacion (importacion_id, fuente, nombre, tema, valor)
         VALUES ($1, 'f', 'n', $2, $3) RETURNING id`, [imp.id, tema, valor]);
      await client.query(`INSERT INTO biodiversidad.conservacion_vinculo VALUES ($1, 'bb', $2, 'nombre_exacto')`, [af.id, clave]);
    };
    await afirmar('amenaza_nacional', 'VU', '1');
    await afirmar('amenaza_nacional', 'CR', '1');
    await afirmar('endemismo_colombia', 'Endémica', '1');
    await afirmar('introducida', 'Alien', '2');
    await afirmar('invasora_declarada', 'Invasora declarada', '2');
    await afirmar('endemismo_choco_reportado', 'Reportada', '2');
  }
  return lote.id;
}

describe('registro_detalle — seguridad', () => {
  it('existe con RLS habilitado', async () => {
    const { rows: [r] } = await query(
      `SELECT c.relrowsecurity FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'biodiversidad' AND c.relname = 'registro_detalle'`);
    expect(r).toEqual({ relrowsecurity: true });
  });

  it('PUBLIC, anon y authenticated no leen la tabla ni la vista de conservación', async () => {
    const { rows: [r] } = await query(
      `SELECT has_table_privilege('public', 'biodiversidad.registro_detalle', 'SELECT') AS tabla,
              has_table_privilege('public', 'biodiversidad.vw_especie_conservacion', 'SELECT') AS vista`);
    expect(r).toEqual({ tabla: false, vista: false });
    for (const rol of ['anon', 'authenticated']) {
      const { rows: [x] } = await query('SELECT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = $1) AS existe', [rol]);
      if (!x.existe) continue;
      const { rows: [p] } = await query(
        `SELECT has_table_privilege($1, 'biodiversidad.registro_detalle', 'SELECT') AS tabla,
                has_table_privilege($1, 'biodiversidad.vw_especie_conservacion', 'SELECT') AS vista`, [rol]);
      expect(p).toEqual({ tabla: false, vista: false });
    }
  });

  it('el rol de ingesta escribe la tabla (pasa RLS) y lee ambas vistas sin poder escribirlas', async () => {
    const { rows: [r] } = await query(
      `SELECT has_table_privilege('biodiversidad_ingesta', 'biodiversidad.registro_detalle', 'INSERT') AS escribe,
              has_table_privilege('biodiversidad_ingesta', 'biodiversidad.vw_especie_conservacion', 'SELECT') AS lee,
              has_table_privilege('biodiversidad_ingesta', 'biodiversidad.vw_especie_conservacion', 'INSERT') AS escribe_vista`);
    expect(r).toEqual({ escribe: true, lee: true, escribe_vista: false });
    await enTransaccion(async (client) => {
      const loteId = await sembrar(client);
      await client.query('SET LOCAL ROLE biodiversidad_ingesta');
      await client.query(
        `INSERT INTO biodiversidad.registro_detalle (lote_id, gbif_id, fotos) VALUES ($1, 'g3', '[]')`, [loteId]);
      const { rows } = await client.query('SELECT count(*)::int AS n FROM biodiversidad.registro_detalle');
      expect(rows[0].n).toBe(3);
    });
  });

  it('exige un registro existente y fotos en forma de arreglo', async () => {
    await enTransaccion(async (client) => {
      const loteId = await sembrar(client);
      await expect(client.query(
        `INSERT INTO biodiversidad.registro_detalle (lote_id, gbif_id) VALUES ($1, 'no-existe')`, [loteId],
      )).rejects.toThrow(/foreign key/);
    });
    await enTransaccion(async (client) => {
      const loteId = await sembrar(client);
      await expect(client.query(
        `INSERT INTO biodiversidad.registro_detalle (lote_id, gbif_id, fotos) VALUES ($1, 'g3', '{"a":1}')`, [loteId],
      )).rejects.toThrow(/check constraint/);
    });
  });
});

describe('vw_registro_publico ampliada', () => {
  const leer = (client) => client.query('SELECT * FROM biodiversidad.vw_registro_publico ORDER BY gbif_id');

  it('conserva las columnas originales (nombre y orden) y añade las nuevas AL FINAL', async () => {
    const { rows } = await query(
      `SELECT attname FROM pg_attribute WHERE attrelid = 'biodiversidad.vw_registro_publico'::regclass
          AND attnum > 0 AND NOT attisdropped ORDER BY attnum`);
    expect(rows.map((r) => r.attname)).toEqual([...COLUMNAS_ORIGINALES, ...COLUMNAS_NUEVAS]);
  });

  it('sigue ocultando las coordenadas de la amenazada (más severa gana) y entrega el detalle', async () => {
    await enTransaccion(async (client) => {
      await sembrar(client);
      const { rows } = await leer(client);
      expect(rows[0]).toMatchObject({
        gbif_id: 'g1', latitud: null, longitud: null, incertidumbre_m: null, coordenadas_ocultas: true,
        registrado_por: 'Ana', identificado_por: 'Beto', occurrence_id: 'occ-1', marcas_revision: 'a;b',
      });
      expect(rows[0].fotos).toEqual([{ imagen: 'x' }]);
      expect(rows[1]).toMatchObject({ gbif_id: 'g2', latitud: 5.7, coordenadas_ocultas: false, registrado_por: null });
    });
  });

  it('un registro sin fila de detalle sigue apareciendo, con fotos = [] y sin autores', async () => {
    await enTransaccion(async (client) => {
      await sembrar(client);
      const g3 = (await leer(client)).rows.find((r) => r.gbif_id === 'g3');
      expect(g3).toMatchObject({ registrado_por: null, identificado_por: null, fotos: [], coordenadas_ocultas: false });
    });
  });

  it('falla cerrado: sin cruce activo oculta todas las coordenadas aunque tenga detalle', async () => {
    await enTransaccion(async (client) => {
      await sembrar(client, { cruceActivo: false });
      const { rows } = await leer(client);
      expect(rows).toHaveLength(3);
      expect(rows.every((r) => r.latitud === null && r.longitud === null && r.coordenadas_ocultas)).toBe(true);
    });
  });

  it('no duplica filas por el detalle (una fila de detalle por registro)', async () => {
    await enTransaccion(async (client) => {
      await sembrar(client);
      expect((await leer(client)).rows).toHaveLength(3);
    });
  });
});

describe('vw_especie_conservacion', () => {
  it('resume por especie la amenaza más severa y los indicadores del cruce activo', async () => {
    await enTransaccion(async (client) => {
      await sembrar(client);
      const { rows } = await client.query(
        'SELECT * FROM biodiversidad.vw_especie_conservacion ORDER BY especie_clave');
      expect(rows).toEqual([
        { clasificacion_clave: 'bb', especie_clave: '1', amenaza_orden: 1, endemica_colombia: true, endemica_choco: false, introducida: false, invasora: false },
        { clasificacion_clave: 'bb', especie_clave: '2', amenaza_orden: null, endemica_colombia: false, endemica_choco: true, introducida: true, invasora: true },
      ]);
    });
  });

  it('solo considera el cruce ACTIVO; sin cruce activo queda vacía', async () => {
    await enTransaccion(async (client) => {
      await sembrar(client);
      await client.query('UPDATE biodiversidad.conservacion_importacion SET activo = false');
      const { rows } = await client.query('SELECT 1 FROM biodiversidad.vw_especie_conservacion');
      expect(rows).toEqual([]);
    });
  });

  it('ignora categorías de amenaza fuera de CR/EN/VU', async () => {
    await enTransaccion(async (client) => {
      await sembrar(client);
      await client.query(`UPDATE biodiversidad.conservacion_afirmacion SET valor = 'LC' WHERE tema = 'amenaza_nacional'`);
      const { rows } = await client.query(
        `SELECT amenaza_orden FROM biodiversidad.vw_especie_conservacion WHERE especie_clave = '1'`);
      expect(rows).toEqual([{ amenaza_orden: null }]);
    });
  });
});

describe('migración 064 — reejecución y reversión', () => {
  it('es idempotente: aplicarla otra vez no falla ni cambia nada', async () => {
    await enTransaccion(async (client) => {
      await client.query(MIGRACION);
      await client.query(MIGRACION);
      const { rows } = await client.query(
        `SELECT attname FROM pg_attribute WHERE attrelid = 'biodiversidad.vw_registro_publico'::regclass
            AND attnum > 0 AND NOT attisdropped ORDER BY attnum`);
      expect(rows.map((r) => r.attname)).toEqual([...COLUMNAS_ORIGINALES, ...COLUMNAS_NUEVAS]);
      const { rows: [p] } = await client.query(
        `SELECT count(*)::int AS n FROM pg_policies WHERE schemaname = 'biodiversidad' AND tablename = 'registro_detalle'`);
      expect(p.n).toBe(1);
    });
  });

  it('la reversión restaura la vista previa y elimina solo lo nuevo', async () => {
    await enTransaccion(async (client) => {
      await client.query(REVERSION);
      const { rows: cols } = await client.query(
        `SELECT attname FROM pg_attribute WHERE attrelid = 'biodiversidad.vw_registro_publico'::regclass
            AND attnum > 0 AND NOT attisdropped ORDER BY attnum`);
      expect(cols.map((r) => r.attname)).toEqual(COLUMNAS_ORIGINALES);
      const { rows: [r] } = await client.query(
        `SELECT to_regclass('biodiversidad.registro_detalle') IS NULL AS sin_tabla,
                to_regclass('biodiversidad.vw_especie_conservacion') IS NULL AS sin_vista,
                to_regclass('biodiversidad.registro') IS NOT NULL AS sigue_registro,
                has_table_privilege('biodiversidad_ingesta', 'biodiversidad.vw_registro_publico', 'SELECT') AS ingesta_lee`);
      expect(r).toEqual({ sin_tabla: true, sin_vista: true, sigue_registro: true, ingesta_lee: true });
    });
  });

  it('tras revertir, la vista previa sigue ocultando las coordenadas de la amenazada', async () => {
    await enTransaccion(async (client) => {
      await client.query(REVERSION);
      await client.query(`INSERT INTO biodiversidad.clasificacion VALUES ('bb', 'GBIF')`);
      await client.query(`INSERT INTO biodiversidad.territorio_version (huella, origen) VALUES ('t1', 'p')`);
      await client.query(`INSERT INTO biodiversidad.conjunto (clave, titulo) VALUES ('ds1', 'C')`);
      const { rows: [l] } = await client.query(
        `INSERT INTO biodiversidad.lote (grupo, metodo, clasificacion_clave, territorio_huella, desde, hasta, huella_fuente, origen, registros, estado, activo)
         VALUES ('anfibios', 'individual', 'bb', 't1', 2000, 2025, 'h', 'p', 1, 'completo', true) RETURNING id`);
      await client.query(
        `INSERT INTO biodiversidad.taxon_version (huella, clasificacion_clave, taxon_clave, especie_clave, especie, linaje)
         VALUES ('tx', 'bb', '1', '1', 'E', '{}')`);
      await client.query(
        `INSERT INTO biodiversidad.registro (lote_id, gbif_id, dataset_key, taxon_huella, latitud, longitud, vista_1000m)
         VALUES ($1, 'g', 'ds1', 'tx', 5, -76, true)`, [l.id]);
      const { rows } = await client.query('SELECT latitud, coordenadas_ocultas FROM biodiversidad.vw_registro_publico');
      expect(rows).toEqual([{ latitud: null, coordenadas_ocultas: true }]);
    });
  });
});
