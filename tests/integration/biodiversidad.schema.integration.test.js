/**
 * Tests de integración — esquema `biodiversidad` (migración 062).
 * Verifican contra PostgreSQL real lo que los mocks no pueden: RLS en todas las
 * tablas, aislamiento del rol de ingesta y que la vista pública oculte las
 * coordenadas de especies amenazadas (fallando cerrado si no hay cruce activo).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { query, getClient } from '../../src/config/database.js';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const MIGRACION = readFileSync(join(RAIZ, 'db/migrations/062_biodiversidad_base.sql'), 'utf8');
const REVERSION = readFileSync(join(RAIZ, 'db/rollback/062_biodiversidad_base.down.sql'), 'utf8');

const TABLAS = [
  'actualizacion', 'asignacion', 'clasificacion', 'conjunto', 'conservacion_afirmacion',
  'conservacion_fuente', 'conservacion_importacion', 'conservacion_vinculo', 'conteo_fuente',
  'entidad', 'faceta_municipal', 'inventario_especie', 'lote', 'municipio', 'registro',
  'resumen_territorial', 'taxon_version', 'territorio_version',
];

/** Ejecuta `fn` dentro de una transacción que siempre se revierte: no deja datos. */
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

async function sembrar(client, { amenazada = true, cruceActivo = true } = {}) {
  await client.query(`INSERT INTO biodiversidad.clasificacion VALUES ('bb', 'GBIF Backbone')`);
  await client.query(`INSERT INTO biodiversidad.territorio_version (huella, origen) VALUES ('t1', 'prueba')`);
  await client.query(`INSERT INTO biodiversidad.municipio VALUES ('t1', '27001', 'Quibdó', 'Chocó')`);
  await client.query(`INSERT INTO biodiversidad.conjunto (clave, titulo, licencia) VALUES ('ds1', 'Conjunto', 'CC_BY_4_0')`);
  const { rows: [lote] } = await client.query(
    `INSERT INTO biodiversidad.lote (grupo, metodo, clasificacion_clave, territorio_huella, desde, hasta, huella_fuente, origen, registros, estado, activo)
     VALUES ('anfibios', 'individual', 'bb', 't1', 2000, 2025, 'h1', 'prueba', 2, 'completo', true) RETURNING id`);
  for (const [huella, clave, nombre] of [['tx1', '1', 'Especie amenazada'], ['tx2', '2', 'Especie común']]) {
    await client.query(
      `INSERT INTO biodiversidad.taxon_version (huella, clasificacion_clave, taxon_clave, rango, nombre_cientifico, especie_clave, especie, linaje)
       VALUES ($1, 'bb', $2, 'SPECIES', $3, $2, $3, '{}')`, [huella, clave, nombre]);
  }
  await client.query(
    `INSERT INTO biodiversidad.registro (lote_id, gbif_id, dataset_key, taxon_huella, anio, latitud, longitud, incertidumbre_m, vista_1000m)
     VALUES ($1, 'g1', 'ds1', 'tx1', 2020, 5.69, -76.65, 30, true), ($1, 'g2', 'ds1', 'tx2', 2021, 5.70, -76.60, 10, true)`, [lote.id]);
  if (cruceActivo) {
    const { rows: [imp] } = await client.query(
      `INSERT INTO biodiversidad.conservacion_importacion (huella, activo) VALUES ('c1', true) RETURNING id`);
    if (amenazada) {
      const { rows: [af] } = await client.query(
        `INSERT INTO biodiversidad.conservacion_afirmacion (importacion_id, fuente, nombre, reino, rango, tema, valor)
         VALUES ($1, 'amenaza_colombia', 'Especie amenazada', 'Animalia', 'SPECIES', 'amenaza_nacional', 'CR') RETURNING id`, [imp.id]);
      await client.query(
        `INSERT INTO biodiversidad.conservacion_vinculo VALUES ($1, 'bb', '1', 'nombre_exacto')`, [af.id]);
    }
  }
  return lote.id;
}

describe('esquema biodiversidad — estructura y seguridad', () => {
  it('crea exactamente las tablas esperadas', async () => {
    const { rows } = await query(
      `SELECT tablename FROM pg_tables WHERE schemaname = 'biodiversidad' ORDER BY tablename`);
    expect(rows.map((r) => r.tablename)).toEqual(TABLAS);
  });

  it('todas las tablas tienen RLS habilitado', async () => {
    const { rows } = await query(
      `SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'biodiversidad' AND c.relkind = 'r' AND NOT c.relrowsecurity`);
    expect(rows).toEqual([]);
  });

  it('PUBLIC no puede usar el esquema ni leer sus tablas', async () => {
    const { rows: [r] } = await query(
      `SELECT has_schema_privilege('public', 'biodiversidad', 'USAGE') AS uso,
              has_table_privilege('public', 'biodiversidad.registro', 'SELECT') AS lectura`);
    expect(r).toEqual({ uso: false, lectura: false });
  });

  it('el rol de ingesta existe sin login ni superusuario', async () => {
    const { rows: [r] } = await query(
      `SELECT rolcanlogin, rolsuper, rolcreaterole, rolcreatedb FROM pg_roles WHERE rolname = 'biodiversidad_ingesta'`);
    expect(r).toEqual({ rolcanlogin: false, rolsuper: false, rolcreaterole: false, rolcreatedb: false });
  });

  it('el rol de ingesta no puede tocar tablas del resto de Vigía', async () => {
    const { rows: [r] } = await query(
      `SELECT has_table_privilege('biodiversidad_ingesta', 'public.usuarios', 'SELECT') AS usuarios,
              has_table_privilege('biodiversidad_ingesta', 'public.refresh_tokens', 'SELECT') AS tokens,
              has_table_privilege('biodiversidad_ingesta', 'public.herramientas', 'UPDATE') AS herramientas,
              has_table_privilege('biodiversidad_ingesta', 'biodiversidad.registro', 'INSERT') AS registro`);
    expect(r).toEqual({ usuarios: false, tokens: false, herramientas: false, registro: true });
  });

  it('el rol de ingesta puede escribir en su esquema (pasa RLS) pero no leer public', async () => {
    await enTransaccion(async (client) => {
      await client.query('SET LOCAL ROLE biodiversidad_ingesta');
      await client.query(`INSERT INTO biodiversidad.clasificacion VALUES ('x', 'X')`);
      const { rows } = await client.query(`SELECT clave FROM biodiversidad.clasificacion`);
      expect(rows).toEqual([{ clave: 'x' }]);
      await expect(client.query('SELECT 1 FROM public.usuarios LIMIT 1')).rejects.toThrow(/permission denied/);
    });
  });

  it('el rol de ingesta no puede escribir en la vista pública y sí leerla', async () => {
    const { rows: [r] } = await query(
      `SELECT has_table_privilege('biodiversidad_ingesta', 'biodiversidad.vw_registro_publico', 'INSERT') AS escribe,
              has_table_privilege('biodiversidad_ingesta', 'biodiversidad.vw_registro_publico', 'SELECT') AS lee`);
    expect(r).toEqual({ escribe: false, lee: true });
  });
});

describe('esquema biodiversidad — integridad de datos', () => {
  it('solo permite un lote activo por grupo', async () => {
    await enTransaccion(async (client) => {
      await sembrar(client);
      await expect(client.query(
        `INSERT INTO biodiversidad.lote (grupo, metodo, clasificacion_clave, territorio_huella, desde, hasta, huella_fuente, origen, registros, estado, activo)
         VALUES ('anfibios', 'individual', 'bb', 't1', 2000, 2025, 'h2', 'prueba', 1, 'completo', true)`,
      )).rejects.toThrow(/duplicate key|un_lote_activo/);
    });
  });

  it('rechaza un lote activo que no esté completo', async () => {
    await enTransaccion(async (client) => {
      await client.query(`INSERT INTO biodiversidad.clasificacion VALUES ('bb', 'GBIF Backbone')`);
      await client.query(`INSERT INTO biodiversidad.territorio_version (huella, origen) VALUES ('t1', 'prueba')`);
      await expect(client.query(
        `INSERT INTO biodiversidad.lote (grupo, metodo, clasificacion_clave, territorio_huella, desde, hasta, huella_fuente, origen, registros, estado, activo)
         VALUES ('aves', 'agregado', 'bb', 't1', 2000, 2025, 'h', 'prueba', 0, 'cargando', true)`,
      )).rejects.toThrow(/check constraint/);
    });
  });

  it('rechaza coordenadas fuera de rango', async () => {
    await enTransaccion(async (client) => {
      const loteId = await sembrar(client);
      await expect(client.query(
        `INSERT INTO biodiversidad.registro (lote_id, gbif_id, dataset_key, taxon_huella, latitud, longitud, vista_1000m)
         VALUES ($1, 'g9', 'ds1', 'tx2', 95, -76.6, false)`, [loteId],
      )).rejects.toThrow(/check constraint/);
    });
  });
});

describe('vista pública — ocultamiento de coordenadas de especies amenazadas', () => {
  const leer = (client) => client.query(
    `SELECT gbif_id, latitud, longitud, incertidumbre_m, coordenadas_ocultas
       FROM biodiversidad.vw_registro_publico ORDER BY gbif_id`);

  it('oculta coordenadas de la especie amenazada y conserva las de la común', async () => {
    await enTransaccion(async (client) => {
      await sembrar(client);
      const { rows } = await leer(client);
      expect(rows).toEqual([
        { gbif_id: 'g1', latitud: null, longitud: null, incertidumbre_m: null, coordenadas_ocultas: true },
        { gbif_id: 'g2', latitud: 5.7, longitud: -76.6, incertidumbre_m: 10, coordenadas_ocultas: false },
      ]);
    });
  });

  it('falla cerrado: sin cruce de conservación activo oculta todas las coordenadas', async () => {
    await enTransaccion(async (client) => {
      await sembrar(client, { cruceActivo: false });
      const { rows } = await leer(client);
      expect(rows.length).toBe(2);
      expect(rows.every((r) => r.latitud === null && r.longitud === null && r.coordenadas_ocultas)).toBe(true);
    });
  });

  it('un cruce inactivo no cuenta como cruce activo', async () => {
    await enTransaccion(async (client) => {
      await sembrar(client, { amenazada: false });
      await client.query(`UPDATE biodiversidad.conservacion_importacion SET activo = false`);
      const { rows } = await leer(client);
      expect(rows.every((r) => r.coordenadas_ocultas)).toBe(true);
    });
  });

  it('con cruce activo y sin amenazadas, muestra todas las coordenadas', async () => {
    await enTransaccion(async (client) => {
      await sembrar(client, { amenazada: false });
      const { rows } = await leer(client);
      expect(rows.length).toBe(2);
      expect(rows.every((r) => r.latitud !== null && !r.coordenadas_ocultas)).toBe(true);
    });
  });

  it('oculta también VU y no oculta categorías fuera de CR/EN/VU', async () => {
    await enTransaccion(async (client) => {
      await sembrar(client);
      await client.query(`UPDATE biodiversidad.conservacion_afirmacion SET valor = 'VU'`);
      expect((await leer(client)).rows[0].coordenadas_ocultas).toBe(true);
      await client.query(`UPDATE biodiversidad.conservacion_afirmacion SET valor = 'LC'`);
      expect((await leer(client)).rows[0].coordenadas_ocultas).toBe(false);
    });
  });

  it('oculta las coordenadas de registros sin especie determinada (no verificables)', async () => {
    await enTransaccion(async (client) => {
      const loteId = await sembrar(client, { amenazada: false });
      await client.query(
        `INSERT INTO biodiversidad.registro (lote_id, gbif_id, dataset_key, taxon_huella, latitud, longitud, vista_1000m)
         VALUES ($1, 'g3', 'ds1', NULL, 5.8, -76.5, true)`, [loteId]);
      const { rows } = await leer(client);
      const sinEspecie = rows.find((r) => r.gbif_id === 'g3');
      expect(sinEspecie).toMatchObject({ latitud: null, longitud: null, coordenadas_ocultas: true });
      expect(rows.find((r) => r.gbif_id === 'g2').coordenadas_ocultas).toBe(false);
    });
  });

  it('solo incluye registros de lotes activos y completos', async () => {
    await enTransaccion(async (client) => {
      await sembrar(client, { amenazada: false });
      await client.query(`UPDATE biodiversidad.lote SET activo = false`);
      expect((await leer(client)).rows).toEqual([]);
    });
  });
});

describe('migración 062 — reejecución y reversión', () => {
  it('es idempotente: aplicarla otra vez no falla ni duplica nada', async () => {
    await enTransaccion(async (client) => {
      await client.query(MIGRACION);
      const { rows } = await client.query(
        `SELECT count(*)::int AS n FROM pg_tables WHERE schemaname = 'biodiversidad'`);
      expect(rows[0].n).toBe(TABLAS.length);
    });
  });

  it('el script de reversión elimina el esquema y el rol sin tocar el resto', async () => {
    await enTransaccion(async (client) => {
      const contar = async () => (await client.query(
        `SELECT count(*)::int AS n FROM pg_tables WHERE schemaname = 'public'`)).rows[0].n;
      const antes = await contar();
      await client.query(REVERSION);
      const { rows: [r] } = await client.query(
        `SELECT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'biodiversidad') AS esquema,
                EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'biodiversidad_ingesta') AS rol`);
      expect(r).toEqual({ esquema: false, rol: false });
      expect(await contar()).toBe(antes);
    });
  });
});
