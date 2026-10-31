/**
 * Tests de integración — servicio de biodiversidad contra PostgreSQL real.
 * Lo crítico aquí no se puede validar con mocks: que la API entregue las coordenadas
 * SOLO a través de la vista pública (ocultando especies amenazadas), que los filtros
 * estén parametrizados y que el interruptor de la herramienta respete roles.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { query } from '../../src/config/database.js';
import { estado, municipios, registros } from '../../src/modules/biodiversidad/biodiversidad.service.js';
import { ConsultaInvalida } from '../../src/modules/biodiversidad/biodiversidad.errores.js';
import { herramientaDisponible } from '../../src/modules/herramientas/herramientas.service.js';

async function limpiar() {
  await query(`TRUNCATE biodiversidad.clasificacion, biodiversidad.territorio_version,
    biodiversidad.entidad, biodiversidad.conjunto, biodiversidad.conservacion_importacion
    RESTART IDENTITY CASCADE`);
}

async function insertarLote(grupo, metodo, huella) {
  const { rows: [l] } = await query(
    `INSERT INTO biodiversidad.lote (grupo, metodo, clasificacion_clave, territorio_huella, desde, hasta, huella_fuente, origen, registros, estado, activo, doi)
     VALUES ($1, $2, 'bb', 't1', 2000, 2025, $3, 'prueba', 3, 'completo', true, '10.1234/prueba') RETURNING id`,
    [grupo, metodo, huella]);
  return l.id;
}

async function sembrar({ amenazada = true, cruceActivo = true } = {}) {
  await query(`INSERT INTO biodiversidad.clasificacion VALUES ('bb', 'GBIF Backbone')`);
  await query(`INSERT INTO biodiversidad.territorio_version (huella, origen) VALUES ('t1', 'prueba')`);
  await query(`INSERT INTO biodiversidad.municipio VALUES ('t1', '27001', 'Quibdó', 'Chocó'), ('t1', '05045', 'Apartadó', 'Antioquia')`);
  await query(`INSERT INTO biodiversidad.conjunto (clave, titulo, licencia, doi) VALUES ('ds1', 'Conjunto de prueba', 'CC_BY_4_0', '10.1234/ds1')`);
  const individual = await insertarLote('anfibios', 'individual', 'h1');
  const agregado = await insertarLote('aves', 'agregado', 'h2');
  for (const [huella, clave, nombre] of [['tx1', '1', 'Especie amenazada'], ['tx2', '2', 'Especie común']]) {
    await query(
      `INSERT INTO biodiversidad.taxon_version (huella, clasificacion_clave, taxon_clave, rango, nombre_cientifico, especie_clave, especie, linaje)
       VALUES ($1, 'bb', $2, 'SPECIES', $3, $2, $3, '{}')`, [huella, clave, nombre]);
  }
  const filas = [['g1', 'tx1', 2020, 5.69, -76.65, '27001'], ['g2', 'tx2', 2021, 5.70, -76.60, '27001'], ['g3', 'tx2', 2015, 7.88, -76.63, '05045']];
  for (const [gbif, taxon, anio, lat, lon, codigo] of filas) {
    await query(
      `INSERT INTO biodiversidad.registro (lote_id, gbif_id, dataset_key, taxon_huella, anio, latitud, longitud, incertidumbre_m, vista_1000m)
       VALUES ($1, $2, 'ds1', $3, $4, $5, $6, 25, true)`, [individual, gbif, taxon, anio, lat, lon]);
    await query(`INSERT INTO biodiversidad.asignacion VALUES ($1, $2, 't1', $3)`, [individual, gbif, codigo]);
  }
  await query(
    `INSERT INTO biodiversidad.resumen_territorial VALUES ($1, 't1', '27001', 2, 0), ($1, 't1', '05045', 1, 0), ($2, 't1', '27001', 500, 3)`,
    [individual, agregado]);
  if (cruceActivo) {
    const { rows: [imp] } = await query(`INSERT INTO biodiversidad.conservacion_importacion (huella, activo) VALUES ('c1', true) RETURNING id`);
    if (amenazada) {
      const { rows: [af] } = await query(
        `INSERT INTO biodiversidad.conservacion_afirmacion (importacion_id, fuente, nombre, reino, rango, tema, valor)
         VALUES ($1, 'amenaza_colombia', 'Especie amenazada', 'Animalia', 'SPECIES', 'amenaza_nacional', 'CR') RETURNING id`, [imp.id]);
      await query(`INSERT INTO biodiversidad.conservacion_vinculo VALUES ($1, 'bb', '1', 'nombre_exacto')`, [af.id]);
    }
  }
}

beforeEach(limpiar);
afterEach(limpiar);

describe('estado()', () => {
  it('lista los lotes activos y si el cruce de conservación está activo', async () => {
    await sembrar();
    const r = await estado();
    expect(r.grupos.map((g) => g.grupo)).toEqual(['anfibios', 'aves']);
    expect(r.grupos[0]).toMatchObject({ metodo: 'individual', desde: 2000, hasta: 2025, doi: '10.1234/prueba' });
    expect(r.conservacion.activa).toBe(true);
    expect(typeof r.aviso).toBe('string');
  });

  it('informa cruce inactivo y no filtra datos internos', async () => {
    await sembrar({ cruceActivo: false });
    const r = await estado();
    expect(r.conservacion.activa).toBe(false);
    expect(JSON.stringify(r)).not.toMatch(/huella_fuente|origen/);
  });
});

describe('municipios()', () => {
  it('devuelve el resumen por municipio ordenado por departamento y nombre', async () => {
    await sembrar();
    const r = await municipios('anfibios');
    expect(r).toMatchObject({ grupo: 'anfibios', metodo: 'individual' });
    expect(r.municipios).toEqual([
      { codigo_municipal: '05045', municipio: 'Apartadó', departamento: 'Antioquia', registros: 1, sin_especie: 0, especies: 1 },
      { codigo_municipal: '27001', municipio: 'Quibdó', departamento: 'Chocó', registros: 2, sin_especie: 0, especies: 2 },
    ]);
  });

  it('devuelve null si el grupo no tiene lote activo', async () => {
    await sembrar();
    expect(await municipios('hongos')).toBeNull();
  });
});

describe('registros() — coordenadas y privacidad', () => {
  it('oculta las coordenadas de la especie amenazada y deja las de las demás', async () => {
    await sembrar();
    const r = await registros({ grupo: 'anfibios', pagina: 1, tamano: 25 });
    const por = Object.fromEntries(r.registros.map((x) => [x.gbif_id, x]));
    expect(por.g1).toMatchObject({ latitud: null, longitud: null, incertidumbre_m: null, coordenadas_ocultas: true });
    expect(por.g2).toMatchObject({ latitud: 5.7, longitud: -76.6, coordenadas_ocultas: false });
    expect(r.total).toBe(3);
  });

  it('falla cerrado: sin cruce de conservación activo no entrega ninguna coordenada', async () => {
    await sembrar({ cruceActivo: false });
    const r = await registros({ grupo: 'anfibios', pagina: 1, tamano: 25 });
    expect(r.registros).toHaveLength(3);
    expect(r.registros.every((x) => x.latitud === null && x.longitud === null && x.coordenadas_ocultas)).toBe(true);
  });

  it('solo entrega los campos públicos esperados', async () => {
    await sembrar();
    const r = await registros({ grupo: 'anfibios', pagina: 1, tamano: 25 });
    expect(Object.keys(r.registros[0]).sort()).toEqual([
      'amenaza', 'anio', 'codigo_municipal', 'conjunto', 'coordenadas_ocultas', 'departamento', 'doi_conjunto', 'endemica_choco',
      'endemica_colombia', 'especie', 'especie_clave', 'fecha_evento', 'foto', 'fotos_total', 'gbif_id', 'identificado_por',
      'incertidumbre_m', 'introducida', 'invasora', 'latitud', 'licencia', 'longitud', 'municipio', 'registrado_por', 'tipo_evidencia',
    ]);
  });
});

describe('registros() — filtros y paginación', () => {
  beforeEach(sembrar);

  it('filtra por municipio, departamento y rango de años', async () => {
    expect((await registros({ grupo: 'anfibios', pagina: 1, tamano: 25, codigo_municipal: '27001' })).registros.map((x) => x.gbif_id)).toEqual(['g1', 'g2']);
    expect((await registros({ grupo: 'anfibios', pagina: 1, tamano: 25, departamento: 'Antioquia' })).registros.map((x) => x.gbif_id)).toEqual(['g3']);
    expect((await registros({ grupo: 'anfibios', pagina: 1, tamano: 25, anio_desde: 2020 })).registros.map((x) => x.gbif_id)).toEqual(['g1', 'g2']);
    expect((await registros({ grupo: 'anfibios', pagina: 1, tamano: 25, anio_hasta: 2016 })).registros.map((x) => x.gbif_id)).toEqual(['g3']);
  });

  it('pagina de forma estable y reporta el total', async () => {
    const p1 = await registros({ grupo: 'anfibios', pagina: 1, tamano: 2 });
    const p2 = await registros({ grupo: 'anfibios', pagina: 2, tamano: 2 });
    expect(p1.registros.map((x) => x.gbif_id)).toEqual(['g1', 'g2']);
    expect(p2.registros.map((x) => x.gbif_id)).toEqual(['g3']);
    expect(p1.total).toBe(3);
    expect(p2).toMatchObject({ pagina: 2, tamano: 2 });
  });

  it('trata el texto del departamento como dato, no como SQL (sin inyección)', async () => {
    const r = await registros({ grupo: 'anfibios', pagina: 1, tamano: 25, departamento: "x' OR '1'='1" });
    expect(r.total).toBe(0);
    expect(r.registros).toEqual([]);
    expect((await query('SELECT count(*)::int AS n FROM biodiversidad.registro')).rows[0].n).toBe(3);
  });

  it('devuelve null si el grupo no tiene lote activo', async () => {
    expect(await registros({ grupo: 'hongos', pagina: 1, tamano: 25 })).toBeNull();
  });

  it('rechaza pedir registros individuales de un grupo de inventario agregado', async () => {
    await expect(registros({ grupo: 'aves', pagina: 1, tamano: 25 })).rejects.toBeInstanceOf(ConsultaInvalida);
  });
});

describe('herramientaDisponible() — interruptor por rol', () => {
  const FILA = `UPDATE herramientas SET activa = $1, visibilidad = $2, deleted_at = $3 WHERE clave = 'biodiversidad'`;
  afterEach(() => query(FILA, [false, 'publico', null]));

  it('existe la fila sembrada por la migración y arranca apagada para el público', async () => {
    const { rows } = await query(`SELECT activa, visibilidad FROM herramientas WHERE clave = 'biodiversidad'`);
    expect(rows).toEqual([{ activa: false, visibilidad: 'publico' }]);
    expect(await herramientaDisponible('biodiversidad', null)).toBe(false);
    expect(await herramientaDisponible('biodiversidad', { rol: 'investigador' })).toBe(false);
  });

  it('un admin puede probarla aunque esté apagada', async () => {
    expect(await herramientaDisponible('biodiversidad', { rol: 'admin_sig' })).toBe(true);
    expect(await herramientaDisponible('biodiversidad', { rol: 'super_admin' })).toBe(true);
  });

  it('encendida y pública, la ve cualquiera', async () => {
    await query(FILA, [true, 'publico', null]);
    expect(await herramientaDisponible('biodiversidad', null)).toBe(true);
    expect(await herramientaDisponible('biodiversidad', { rol: 'visitante' })).toBe(true);
  });

  it('encendida solo para usuarios: el visitante y el anónimo no la ven', async () => {
    await query(FILA, [true, 'usuarios', null]);
    expect(await herramientaDisponible('biodiversidad', null)).toBe(false);
    expect(await herramientaDisponible('biodiversidad', { rol: 'visitante' })).toBe(false);
    expect(await herramientaDisponible('biodiversidad', { rol: 'investigador' })).toBe(true);
  });

  it('un rol desconocido cae en la rama intermedia (ve usuarios y público, nunca más)', async () => {
    await query(FILA, [true, 'usuarios', null]);
    expect(await herramientaDisponible('biodiversidad', { rol: 'rol_futuro' })).toBe(true);
    await query(FILA, [false, 'usuarios', null]);
    expect(await herramientaDisponible('biodiversidad', { rol: 'rol_futuro' })).toBe(false);
  });

  it('una herramienta borrada lógicamente nunca está disponible, ni para admin', async () => {
    await query(FILA, [true, 'publico', new Date()]);
    expect(await herramientaDisponible('biodiversidad', { rol: 'super_admin' })).toBe(false);
    expect(await herramientaDisponible('biodiversidad', null)).toBe(false);
  });

  it('una clave inexistente no está disponible', async () => {
    expect(await herramientaDisponible('no-existe', { rol: 'super_admin' })).toBe(false);
  });
});
