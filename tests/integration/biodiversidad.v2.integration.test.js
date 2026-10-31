/**
 * Tests de integración — API v2 de biodiversidad (resumen, especies, series, detalle y filtros nuevos)
 * contra PostgreSQL real. Lo crítico: privacidad de coordenadas (también en el detalle y con fotos),
 * validación de fotos en el servidor, consultas parametrizadas y coherencia entre individuales y agregados.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { query } from '../../src/config/database.js';
import {
  municipios, registros, registro, resumen, especies, series,
} from '../../src/modules/biodiversidad/biodiversidad.service.js';
import { ConsultaInvalida } from '../../src/modules/biodiversidad/biodiversidad.errores.js';

const img = (n, hash) => `https://api.gbif.org/v1/image/cache/500x/occurrence/${n}/media/${hash.repeat(32).slice(0, 32)}`;
const FOTO_S3 = { imagen: 'https://inaturalist-open-data.s3.amazonaws.com/photos/1/original.jpeg', autor: 'X', editor: 'Y', licencia: 'L', referencia: 'https://www.inaturalist.org/photos/9' };
const foto = (n, hash, autor = 'Ana') => ({ imagen: img(n, hash), autor, editor: 'iNaturalist', licencia: 'CC-BY', referencia: `https://www.inaturalist.org/photos/${n}` });

async function limpiar() {
  await query(`TRUNCATE biodiversidad.clasificacion, biodiversidad.territorio_version,
    biodiversidad.entidad, biodiversidad.conjunto, biodiversidad.conservacion_importacion
    RESTART IDENTITY CASCADE`);
}

async function insertarLote(grupo, metodo, huella, registrosN) {
  const { rows: [l] } = await query(
    `INSERT INTO biodiversidad.lote (grupo, metodo, clasificacion_clave, territorio_huella, desde, hasta, huella_fuente, origen, registros, estado, activo, doi)
     VALUES ($1, $2, 'bb', 't1', 2000, 2025, $3, 'prueba', $4, 'completo', true, '10.1234/prueba') RETURNING id`,
    [grupo, metodo, huella, registrosN]);
  return l.id;
}

async function afirmar(importacion, tema, valor, especieClave) {
  const { rows: [af] } = await query(
    `INSERT INTO biodiversidad.conservacion_afirmacion (importacion_id, fuente, nombre, tema, valor)
     VALUES ($1, 'f', 'n', $2, $3) RETURNING id`, [importacion, tema, valor]);
  await query(`INSERT INTO biodiversidad.conservacion_vinculo VALUES ($1, 'bb', $2, 'nombre_exacto')`, [af.id, especieClave]);
}

/**
 * Especies: 1 amenazada (VU y CR → CR), 2 común, 3 endémica de Colombia y del Chocó, 4 invasora e introducida.
 * Registros individuales (anfibios): g1 (sp1, Quibdó, foto válida + inválida), g2 (sp2, Quibdó, 2 fotos),
 * g3 (sp2, Apartadó, sin fila de detalle), g4 (sp3, Quibdó, 1 foto), g5 (sin especie), g6 (sp4, en dos municipios).
 * Aves (agregado): sp1 y sp2 en Quibdó, sp2 en Apartadó.
 */
async function sembrar({ cruceActivo = true } = {}) {
  await query(`INSERT INTO biodiversidad.clasificacion VALUES ('bb', 'GBIF Backbone')`);
  await query(`INSERT INTO biodiversidad.territorio_version (huella, origen) VALUES ('t1', 'prueba')`);
  await query(`INSERT INTO biodiversidad.municipio VALUES ('t1', '27001', 'Quibdó', 'Chocó'), ('t1', '05045', 'Apartadó', 'Antioquia')`);
  await query(`INSERT INTO biodiversidad.conjunto (clave, titulo, licencia, doi) VALUES ('ds1', 'Conjunto de prueba', 'CC_BY_4_0', '10.1234/ds1')`);
  const ind = await insertarLote('anfibios', 'individual', 'h1', 6);
  const agr = await insertarLote('aves', 'agregado', 'h2', 700);
  const taxones = [
    ['tx1', '1', 'Pristimantis amenazado', 'Craugastoridae'], ['tx2', '2', 'Rhinella común', 'Bufonidae'],
    ['tx3', '3', 'Atelopus endémico', 'Bufonidae'], ['tx4', '4', 'Eleutherodactylus invasor', 'Eleutherodactylidae'],
  ];
  for (const [huella, clave, nombre, familia] of taxones) {
    await query(
      `INSERT INTO biodiversidad.taxon_version (huella, clasificacion_clave, taxon_clave, rango, nombre_cientifico, reino, clase, orden, familia, genero, especie_clave, especie, linaje)
       VALUES ($1, 'bb', $2, 'SPECIES', $3, 'Animalia', 'Amphibia', 'Anura', $4, split_part($3, ' ', 1), $2, $3, '{}')`,
      [huella, clave, nombre, familia]);
  }
  const filas = [
    ['g1', 'tx1', 2020, 5.69, -76.65, ['27001']], ['g2', 'tx2', 2021, 5.70, -76.60, ['27001']],
    ['g3', 'tx2', 2015, 7.88, -76.63, ['05045']], ['g4', 'tx3', 2021, 5.71, -76.61, ['27001']],
    ['g5', null, 2010, 5.72, -76.62, ['27001']], ['g6', 'tx4', 2022, 5.73, -76.63, ['27001', '05045']],
  ];
  for (const [gbif, taxon, anio, lat, lon, codigos] of filas) {
    await query(
      `INSERT INTO biodiversidad.registro (lote_id, gbif_id, dataset_key, taxon_huella, anio, fecha_evento, latitud, longitud, incertidumbre_m, tipo_evidencia, licencia,
         occurrence_id, institution_code, collection_code, catalog_number, nombre_original, marcas_revision, vista_1000m)
       VALUES ($1, $2, 'ds1', $3, $4, $5, $6, $7, 25, $8, 'CC_BY_4_0', $9, 'INST', 'COL', 'CAT-1', 'Nombre original', $10, true)`,
      [ind, gbif, taxon, anio, `${anio}-03-04`, lat, lon, anio >= 2021 ? 'PRESERVED_SPECIMEN' : 'HUMAN_OBSERVATION', `occ-${gbif}`, 'incertidumbre_no_informada;sin_clave_especie']);
    for (const c of codigos) await query(`INSERT INTO biodiversidad.asignacion VALUES ($1, $2, 't1', $3)`, [ind, gbif, c]);
  }
  const detalle = [
    ['g1', 'Ana Pérez', 'Beto Ruiz', [foto(1, 'a'), FOTO_S3, foto(11, 'b')], ['COORDINATE_ROUNDED']],
    ['g2', 'Carla', null, [foto(2, 'c'), foto(22, 'd', 'Luis')], ['TAXON_ID_NOT_FOUND', 'COLLECTION_MATCH_FUZZY', 'minuscula', 7, 'X; DROP', '<script>']],
    ['g4', null, 'Diego', [foto(4, 'e')], []],
    ['g6', 'Eva', 'Eva', [FOTO_S3], []],
  ];
  for (const [gbif, obs, ident, fotos, marcas] of detalle) {
    await query(
      `INSERT INTO biodiversidad.registro_detalle (lote_id, gbif_id, registrado_por, identificado_por, fotos, marcas_gbif) VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb)`,
      [ind, gbif, obs, ident, JSON.stringify(fotos), JSON.stringify(marcas)]);
  }
  await query(
    `INSERT INTO biodiversidad.resumen_territorial VALUES ($1, 't1', '27001', 4, 0), ($1, 't1', '05045', 2, 0), ($2, 't1', '27001', 500, 3), ($2, 't1', '05045', 200, 0)`,
    [ind, agr]);
  await query(
    `INSERT INTO biodiversidad.inventario_especie VALUES ($1, '27001', 'tx1', 100), ($1, '27001', 'tx2', 400), ($1, '05045', 'tx2', 200)`, [agr]);
  await query(
    `INSERT INTO biodiversidad.faceta_municipal VALUES ($1, '27001', 'anio', '2020', 300), ($1, '27001', 'anio', '2024', 200),
       ($1, '05045', 'anio', '2020', 200), ($1, '27001', 'tipo_evidencia', 'HUMAN_OBSERVATION', 500), ($1, '05045', 'tipo_evidencia', 'HUMAN_OBSERVATION', 150),
       ($1, '05045', 'tipo_evidencia', 'MACHINE_OBSERVATION', 50)`, [agr]);
  if (cruceActivo) {
    const { rows: [imp] } = await query(`INSERT INTO biodiversidad.conservacion_importacion (huella, activo) VALUES ('c1', true) RETURNING id`);
    await afirmar(imp.id, 'amenaza_nacional', 'VU', '1');
    await afirmar(imp.id, 'amenaza_nacional', 'CR', '1');
    await afirmar(imp.id, 'endemismo_colombia', 'Endémica', '3');
    await afirmar(imp.id, 'endemismo_choco_reportado', 'Reportada', '3');
    await afirmar(imp.id, 'introducida', 'Alien', '4');
    await afirmar(imp.id, 'invasora_declarada', 'Invasora declarada', '4');
  }
}

beforeEach(limpiar);
afterEach(limpiar);

const base = (extra) => ({ grupo: 'anfibios', pagina: 1, tamano: 25, orden: 'anio_asc', ...extra });
const ids = (r) => r.registros.map((x) => x.gbif_id);

describe('municipios() — especies', () => {
  it('cuenta especies distintas por municipio en individuales (sin contar registros sin especie)', async () => {
    await sembrar();
    const r = await municipios({ grupo: 'anfibios' });
    expect(r.municipios.map((m) => [m.codigo_municipal, m.especies])).toEqual([['05045', 2], ['27001', 4]]);
    expect(r.municipios[0]).toMatchObject({ registros: 2, sin_especie: 0 });
  });

  it('en agregados la cuenta sale del inventario por especie', async () => {
    await sembrar();
    const r = await municipios({ grupo: 'aves' });
    expect(r.municipios.map((m) => [m.codigo_municipal, m.especies])).toEqual([['05045', 1], ['27001', 2]]);
  });
});

describe('resumen()', () => {
  it('individuales: conteos, fotos válidas, años y conservación por especie distinta', async () => {
    await sembrar();
    const r = await resumen({ grupo: 'anfibios' });
    expect(r).toMatchObject({
      grupo: 'anfibios', metodo: 'individual', alcance: { codigo_municipal: null, departamento: null },
      registros: 6, especies: 4, con_foto: 3,
      amenazadas: { CR: 1, EN: 0, VU: 0, total: 1 },
      endemicas_colombia: 1, endemicas_choco: 1, introducidas: 1, invasoras: 1,
      anio_min: 2010, anio_max: 2022,
    });
  });

  it('un registro asignado a dos municipios cuenta una sola vez; el alcance filtra', async () => {
    await sembrar();
    const choco = await resumen({ grupo: 'anfibios', departamento: 'Chocó' });
    expect(choco).toMatchObject({ registros: 5, especies: 4, alcance: { departamento: 'Chocó', codigo_municipal: null } });
    const apartado = await resumen({ grupo: 'anfibios', codigo_municipal: '05045' });
    expect(apartado).toMatchObject({ registros: 2, especies: 2, con_foto: 0, amenazadas: { total: 0 }, anio_min: 2015, anio_max: 2022 });
    const ambos = await resumen({ grupo: 'anfibios', departamento: 'Chocó', codigo_municipal: '05045' });
    expect(ambos.registros).toBe(0);
  });

  it('agregados: sin con_foto, especies del inventario y años de las facetas', async () => {
    await sembrar();
    const r = await resumen({ grupo: 'aves' });
    expect(r).toMatchObject({
      metodo: 'agregado', registros: 700, especies: 2, con_foto: null,
      amenazadas: { CR: 1, EN: 0, VU: 0, total: 1 }, endemicas_colombia: 0, anio_min: 2020, anio_max: 2024,
    });
    const antioquia = await resumen({ grupo: 'aves', departamento: 'Antioquia' });
    expect(antioquia).toMatchObject({ registros: 200, especies: 1, amenazadas: { total: 0 }, anio_min: 2020, anio_max: 2020 });
  });

  it('falla cerrado sin cruce: las banderas de conservación quedan en cero', async () => {
    await sembrar({ cruceActivo: false });
    const r = await resumen({ grupo: 'anfibios' });
    expect(r).toMatchObject({ amenazadas: { CR: 0, EN: 0, VU: 0, total: 0 }, endemicas_colombia: 0, invasoras: 0 });
  });

  it('null si el grupo no tiene lote activo; el departamento es un dato, no SQL', async () => {
    await sembrar();
    expect(await resumen({ grupo: 'hongos' })).toBeNull();
    const r = await resumen({ grupo: 'anfibios', departamento: "x' OR '1'='1" });
    expect(r.registros).toBe(0);
  });
});

describe('especies()', () => {
  it('lista las especies con taxonomía, conteos y conservación (amenaza más severa)', async () => {
    await sembrar();
    const r = await especies({ grupo: 'anfibios', orden: 'registros', pagina: 1, tamano: 25 });
    expect(r).toMatchObject({ grupo: 'anfibios', metodo: 'individual', pagina: 1, tamano: 25, total: 4 });
    expect(r.especies[0]).toEqual({
      especie: 'Rhinella común', especie_clave: '2', reino: 'Animalia', clase: 'Amphibia', orden: 'Anura', familia: 'Bufonidae', genero: 'Rhinella',
      registros: 2, municipios: 2, amenaza: null, endemica_colombia: false, endemica_choco: false, introducida: false, invasora: false,
      foto: foto(2, 'c'), fotos_total: 2,
    });
    const por = Object.fromEntries(r.especies.map((e) => [e.especie_clave, e]));
    expect(por['1']).toMatchObject({ amenaza: 'CR', registros: 1, municipios: 1 });
    expect(por['3']).toMatchObject({ endemica_colombia: true, endemica_choco: true, amenaza: null });
    expect(por['4']).toMatchObject({ introducida: true, invasora: true, registros: 1, municipios: 2 });
  });

  it('ordena por nombre y pagina con total estable', async () => {
    await sembrar();
    const p1 = await especies({ grupo: 'anfibios', orden: 'nombre', pagina: 1, tamano: 2 });
    const p2 = await especies({ grupo: 'anfibios', orden: 'nombre', pagina: 2, tamano: 2 });
    const p3 = await especies({ grupo: 'anfibios', orden: 'nombre', pagina: 3, tamano: 2 });
    expect(p1.especies.map((e) => e.especie_clave)).toEqual(['3', '4']);
    expect(p2.especies.map((e) => e.especie_clave)).toEqual(['1', '2']);
    expect([p1.total, p2.total, p3.total]).toEqual([4, 4, 4]);
    expect(p3.especies).toEqual([]);
  });

  it('filtra por buscar sin distinguir mayúsculas ni acentos', async () => {
    await sembrar();
    const r = await especies({ grupo: 'anfibios', orden: 'registros', pagina: 1, tamano: 25, buscar: 'COMUN' });
    expect(r.especies.map((e) => e.especie_clave)).toEqual(['2']);
  });

  it('los comodines de buscar se tratan como texto literal', async () => {
    await sembrar();
    for (const buscar of ['%%', '__', '\\', 'R%', '%a']) {
      const r = await especies({ grupo: 'anfibios', orden: 'registros', pagina: 1, tamano: 25, buscar });
      expect(r.total, buscar).toBe(0);
    }
  });

  it('buscar y departamento con intentos de inyección no alteran la consulta ni la BD', async () => {
    await sembrar();
    for (const buscar of ["x'; DROP TABLE biodiversidad.registro;--", "' OR '1'='1", '") OR 1=1 --']) {
      const r = await especies({ grupo: 'anfibios', orden: 'registros', pagina: 1, tamano: 25, buscar });
      expect(r.total).toBe(0);
    }
    const d = await especies({ grupo: 'anfibios', orden: 'registros', pagina: 1, tamano: 25, departamento: "' OR 1=1 --" });
    expect(d.total).toBe(0);
    expect((await query('SELECT count(*)::int AS n FROM biodiversidad.registro')).rows[0].n).toBe(6);
  });

  it('filtra por conservación y por categoría de amenaza', async () => {
    await sembrar();
    const f = (extra) => especies({ grupo: 'anfibios', orden: 'nombre', pagina: 1, tamano: 25, ...extra }).then((r) => r.especies.map((e) => e.especie_clave));
    expect(await f({ conservacion: 'amenazada' })).toEqual(['1']);
    expect(await f({ conservacion: 'endemica' })).toEqual(['3']);
    expect(await f({ conservacion: 'introducida' })).toEqual(['4']);
    expect(await f({ conservacion: 'invasora' })).toEqual(['4']);
    expect(await f({ amenaza: 'CR' })).toEqual(['1']);
    expect(await f({ amenaza: 'VU' })).toEqual([]);
  });

  it('respeta el alcance territorial y cuenta municipios dentro del alcance', async () => {
    await sembrar();
    const r = await especies({ grupo: 'anfibios', orden: 'registros', pagina: 1, tamano: 25, codigo_municipal: '05045' });
    expect(r.especies.map((e) => [e.especie_clave, e.registros, e.municipios]).sort()).toEqual([['2', 1, 1], ['4', 1, 1]]);
  });

  it('funciona en agregados desde el inventario', async () => {
    await sembrar();
    const r = await especies({ grupo: 'aves', orden: 'registros', pagina: 1, tamano: 25 });
    expect(r).toMatchObject({ metodo: 'agregado', total: 2 });
    expect(r.especies.map((e) => [e.especie_clave, e.registros, e.municipios, e.amenaza])).toEqual([['2', 600, 2, null], ['1', 100, 1, 'CR']]);
    const dep = await especies({ grupo: 'aves', orden: 'registros', pagina: 1, tamano: 25, departamento: 'Antioquia' });
    expect(dep.especies.map((e) => e.especie_clave)).toEqual(['2']);
  });

  it('null si el grupo no tiene lote activo', async () => {
    await sembrar();
    expect(await especies({ grupo: 'hongos', orden: 'registros', pagina: 1, tamano: 25 })).toBeNull();
  });
});

/** Registro adicional de anfibios para las pruebas de foto representativa (misma geometría que el sembrado). */
async function registroExtra(gbif, taxon, anio, codigos, fotos) {
  const { rows: [{ id }] } = await query(`SELECT id FROM biodiversidad.lote WHERE grupo = 'anfibios'`);
  await query(
    `INSERT INTO biodiversidad.registro (lote_id, gbif_id, dataset_key, taxon_huella, anio, latitud, longitud, incertidumbre_m, tipo_evidencia, licencia, vista_1000m)
     VALUES ($1, $2, 'ds1', $3, $4, 5.8, -76.7, 25, 'HUMAN_OBSERVATION', 'CC_BY_4_0', true)`, [id, gbif, taxon, anio]);
  for (const c of codigos) await query(`INSERT INTO biodiversidad.asignacion VALUES ($1, $2, 't1', $3)`, [id, gbif, c]);
  if (fotos) {
    await query(`INSERT INTO biodiversidad.registro_detalle (lote_id, gbif_id, fotos) VALUES ($1, $2, $3::jsonb)`, [id, gbif, JSON.stringify(fotos)]);
  }
}

const porClave = (r) => Object.fromEntries(r.especies.map((e) => [e.especie_clave, e]));
const listar = (extra) => especies({ grupo: 'anfibios', orden: 'nombre', pagina: 1, tamano: 25, ...extra });

describe('especies() — foto representativa', () => {
  it('entrega la foto de la primera foto válida del registro elegido y cuenta solo fotos válidas', async () => {
    await sembrar();
    const por = porClave(await listar());
    expect(por['1']).toMatchObject({ foto: foto(1, 'a'), fotos_total: 2 });
    expect(por['2']).toMatchObject({ foto: foto(2, 'c'), fotos_total: 2 });
    expect(por['3']).toMatchObject({ foto: foto(4, 'e'), fotos_total: 1 });
    expect(por['4']).toMatchObject({ foto: null, fotos_total: 0 });
  });

  it('elige el registro de año más reciente', async () => {
    await sembrar();
    await registroExtra('g20', 'tx2', 2024, ['27001'], [foto(200, 'f', 'Reciente')]);
    await registroExtra('g21', 'tx2', 2005, ['27001'], [foto(210, 'f', 'Antigua')]);
    const e = porClave(await listar())['2'];
    expect(e.foto).toEqual(foto(200, 'f', 'Reciente'));
    expect(e.fotos_total).toBe(2 + 1 + 1);
  });

  it('a igualdad de año desempata por menor gbif_id, sin depender del orden de inserción', async () => {
    await sembrar();
    await registroExtra('g25', 'tx2', 2021, ['27001'], [foto(250, '1', 'Z')]);
    await registroExtra('g10', 'tx2', 2021, ['27001'], [foto(100, '2', 'A')]);
    expect(porClave(await listar())['2'].foto).toEqual(foto(100, '2', 'A'));
  });

  it('descarta un registro más reciente cuyas URLs no son válidas y pasa al siguiente', async () => {
    await sembrar();
    await registroExtra('g30', 'tx2', 2025, ['27001'], [FOTO_S3, { ...foto(300, '3'), referencia: 'http://inseguro.example/x' }, { ...foto(301, '4'), imagen: 'https://evil.example/v1/image/cache/500x/occurrence/1/media/' + 'a'.repeat(32) }]);
    const e = porClave(await listar())['2'];
    expect(e.foto).toEqual(foto(2, 'c'));
    expect(e.fotos_total).toBe(2);
  });

  it('un registro sin año pierde frente a uno con año', async () => {
    await sembrar();
    await registroExtra('g31', 'tx2', null, ['27001'], [foto(310, '5')]);
    expect(porClave(await listar())['2'].foto).toEqual(foto(2, 'c'));
  });

  it('un registro en dos municipios no duplica sus fotos en fotos_total', async () => {
    await sembrar();
    await registroExtra('g32', 'tx3', 2022, ['27001', '05045'], [foto(320, '6'), foto(321, '7')]);
    const e = porClave(await listar())['3'];
    expect(e.fotos_total).toBe(3);
    expect(e.foto).toEqual(foto(320, '6'));
  });

  it('respeta el alcance: la foto y el total salen solo de los registros del municipio o departamento', async () => {
    await sembrar();
    await registroExtra('g40', 'tx2', 2024, ['05045'], [foto(400, '8', 'Apartadó')]);
    const quibdo = porClave(await listar({ codigo_municipal: '27001' }))['2'];
    expect(quibdo).toMatchObject({ foto: foto(2, 'c'), fotos_total: 2 });
    const apartado = porClave(await listar({ codigo_municipal: '05045' }))['2'];
    expect(apartado).toMatchObject({ foto: foto(400, '8', 'Apartadó'), fotos_total: 1 });
    const antioquia = porClave(await listar({ departamento: 'Antioquia' }))['2'];
    expect(antioquia.foto).toEqual(foto(400, '8', 'Apartadó'));
    const choco = porClave(await listar({ departamento: 'Chocó' }))['2'];
    expect(choco).toMatchObject({ foto: foto(2, 'c'), fotos_total: 2 });
    const sinFoto = porClave(await listar({ codigo_municipal: '05045' }))['4'];
    expect(sinFoto).toMatchObject({ foto: null, fotos_total: 0 });
  });

  it('con_foto=true deja solo especies con al menos una foto válida y mantiene total y paginación', async () => {
    await sembrar();
    const r = await listar({ con_foto: true });
    expect(r.especies.map((e) => e.especie_clave)).toEqual(['3', '1', '2']);
    expect(r.total).toBe(3);
    expect(r.especies.every((e) => e.foto !== null && e.fotos_total > 0)).toBe(true);
    const p2 = await listar({ con_foto: true, tamano: 2, pagina: 2 });
    expect(p2.especies.map((e) => e.especie_clave)).toEqual(['2']);
    expect(p2.total).toBe(3);
    const fuera = await listar({ con_foto: true, tamano: 2, pagina: 3 });
    expect(fuera.especies).toEqual([]);
    expect(fuera.total).toBe(3);
  });

  it('con_foto=true respeta el alcance territorial y combina con otros filtros', async () => {
    await sembrar();
    expect((await listar({ con_foto: true, codigo_municipal: '05045' })).especies).toEqual([]);
    expect((await listar({ con_foto: true, departamento: 'Chocó', conservacion: 'amenazada' })).especies.map((e) => e.especie_clave)).toEqual(['1']);
  });

  it('con_foto no altera el conteo de registros de la especie', async () => {
    await sembrar();
    const sin = porClave(await listar())['2'];
    const con = porClave(await listar({ con_foto: true }))['2'];
    expect(con.registros).toBe(sin.registros);
    expect(con.municipios).toBe(sin.municipios);
  });

  it('en grupos agregados foto=null y fotos_total=0; con_foto responde 422 «no aplica»', async () => {
    await sembrar();
    const r = await especies({ grupo: 'aves', orden: 'registros', pagina: 1, tamano: 25 });
    expect(r.especies.every((e) => e.foto === null && e.fotos_total === 0)).toBe(true);
    await expect(especies({ grupo: 'aves', orden: 'registros', pagina: 1, tamano: 25, con_foto: true }))
      .rejects.toThrow(ConsultaInvalida);
    await expect(especies({ grupo: 'aves', orden: 'registros', pagina: 1, tamano: 25, con_foto: true }))
      .rejects.toMatchObject({ status: 422, message: expect.stringMatching(/no aplica/) });
  });

  it('mantiene intactos los campos previos y no expone coordenadas ni la lista cruda de fotos', async () => {
    await sembrar();
    const r = await listar();
    for (const e of r.especies) {
      expect(Object.keys(e).sort()).toEqual([
        'amenaza', 'clase', 'endemica_choco', 'endemica_colombia', 'especie', 'especie_clave', 'familia', 'foto', 'fotos_total',
        'genero', 'introducida', 'invasora', 'municipios', 'orden', 'registros', 'reino',
      ]);
      if (e.foto) expect(Object.keys(e.foto).sort()).toEqual(['autor', 'editor', 'imagen', 'licencia', 'referencia']);
    }
    expect(JSON.stringify(r)).not.toMatch(/latitud|longitud|5\.69|-76\.6|s3\.amazonaws/);
  });

  it('la foto sale aunque la especie esté amenazada (las fotos no revelan coordenadas) y las coordenadas siguen ocultas en /registros', async () => {
    await sembrar();
    expect(porClave(await listar())['1'].foto).toEqual(foto(1, 'a'));
    const reg = await registros(base({ especie_clave: '1' }));
    expect(reg.registros[0]).toMatchObject({ latitud: null, longitud: null, coordenadas_ocultas: true });
  });
});

describe('registros() — campos y filtros nuevos', () => {
  it('entrega fecha, observador, foto principal válida y el total de fotos válidas', async () => {
    await sembrar();
    const r = await registros(base());
    const por = Object.fromEntries(r.registros.map((x) => [`${x.gbif_id}`, x]));
    expect(por.g1).toMatchObject({
      fecha_evento: '2020-03-04', registrado_por: 'Ana Pérez', identificado_por: 'Beto Ruiz', fotos_total: 2,
      foto: foto(1, 'a'), amenaza: 'CR',
    });
    expect(por.g2.fotos_total).toBe(2);
    expect(por.g4).toMatchObject({ registrado_por: null, identificado_por: 'Diego', endemica_colombia: true, endemica_choco: true });
    expect(por.g6).toMatchObject({ foto: null, fotos_total: 0, introducida: true, invasora: true });
    expect(JSON.stringify(r)).not.toMatch(/amazonaws|original/);
  });

  it('un registro sin fila de detalle devuelve foto null y 0 fotos', async () => {
    await sembrar();
    const r = await registros(base({ codigo_municipal: '05045' }));
    const g3 = r.registros.find((x) => x.gbif_id === 'g3');
    expect(g3).toMatchObject({ foto: null, fotos_total: 0, registrado_por: null, identificado_por: null });
  });

  it('las fotos con URL inválida se descartan y no cuentan (fotos_total y con_foto)', async () => {
    await sembrar();
    const r = await registros(base());
    const g6 = r.registros.find((x) => x.gbif_id === 'g6');
    expect(g6.fotos_total).toBe(0);
    expect(ids(await registros(base({ con_foto: true })))).toEqual(['g1', 'g2', 'g4']);
  });

  it('no entrega la lista completa de fotos ni las marcas de GBIF en el listado', async () => {
    await sembrar();
    const r = await registros(base());
    expect(r.registros.every((x) => !('fotos' in x) && !('marcas_gbif' in x))).toBe(true);
  });

  it('el campo es exactamente el contrato', async () => {
    await sembrar();
    const r = await registros(base());
    expect(Object.keys(r.registros[0]).sort()).toEqual([
      'amenaza', 'anio', 'codigo_municipal', 'conjunto', 'coordenadas_ocultas', 'departamento', 'doi_conjunto', 'endemica_choco',
      'endemica_colombia', 'especie', 'especie_clave', 'fecha_evento', 'foto', 'fotos_total', 'gbif_id', 'identificado_por',
      'incertidumbre_m', 'introducida', 'invasora', 'latitud', 'licencia', 'longitud', 'municipio', 'registrado_por', 'tipo_evidencia',
    ]);
  });

  it('privacidad: la amenazada oculta sus coordenadas aunque tenga foto; las demás no', async () => {
    await sembrar();
    const r = await registros(base({ con_foto: true }));
    const g1 = r.registros.find((x) => x.gbif_id === 'g1');
    expect(g1).toMatchObject({ latitud: null, longitud: null, incertidumbre_m: null, coordenadas_ocultas: true });
    expect(g1.foto).not.toBeNull();
    expect(r.registros.find((x) => x.gbif_id === 'g2')).toMatchObject({ latitud: 5.7, longitud: -76.6, coordenadas_ocultas: false });
    const sinEspecie = (await registros(base())).registros.find((x) => x.gbif_id === 'g5');
    expect(sinEspecie).toMatchObject({ latitud: null, coordenadas_ocultas: true });
  });

  it('privacidad: sin cruce activo ninguna coordenada sale, ni con fotos ni con filtros', async () => {
    await sembrar({ cruceActivo: false });
    for (const extra of [{}, { con_foto: true }, { buscar: 'rhinella' }, { conservacion: 'endemica' }]) {
      const r = await registros(base(extra));
      expect(r.registros.every((x) => x.latitud === null && x.longitud === null && x.incertidumbre_m === null && x.coordenadas_ocultas)).toBe(true);
    }
  });

  it('filtra por buscar, especie_clave y conservación', async () => {
    await sembrar();
    expect(ids(await registros(base({ buscar: 'rhinella' })))).toEqual(['g3', 'g2']);
    expect(ids(await registros(base({ especie_clave: '2' })))).toEqual(['g3', 'g2']);
    expect(ids(await registros(base({ conservacion: 'amenazada' })))).toEqual(['g1']);
    expect(ids(await registros(base({ amenaza: 'CR' })))).toEqual(['g1']);
    expect(ids(await registros(base({ amenaza: 'EN' })))).toEqual([]);
    expect(ids(await registros(base({ conservacion: 'endemica' })))).toEqual(['g4']);
    expect(ids(await registros(base({ conservacion: 'invasora' })))).toEqual(['g6']);
  });

  it('combina filtros y el total refleja el conjunto filtrado', async () => {
    await sembrar();
    const r = await registros(base({ con_foto: true, codigo_municipal: '27001', buscar: 'rhinella' }));
    expect(ids(r)).toEqual(['g2']);
    expect(r.total).toBe(1);
  });

  it('buscar escapa comodines y no permite inyección', async () => {
    await sembrar();
    for (const buscar of ['%%', '__', "x'; DROP TABLE biodiversidad.registro;--", "' OR '1'='1"]) {
      expect((await registros(base({ buscar }))).total, buscar).toBe(0);
    }
    expect((await query('SELECT count(*)::int AS n FROM biodiversidad.registro')).rows[0].n).toBe(6);
  });

  it('un grupo agregado responde ConsultaInvalida (422)', async () => {
    await sembrar();
    await expect(registros(base({ grupo: 'aves' }))).rejects.toBeInstanceOf(ConsultaInvalida);
  });
});

describe('registro() — detalle', () => {
  it('entrega el registro completo con todas las fotos válidas, marcas, procedencia y taxonomía', async () => {
    await sembrar();
    const r = await registro('g2', 'anfibios');
    expect(r).toMatchObject({
      gbif_id: 'g2', especie: 'Rhinella común', anio: 2021, registrado_por: 'Carla', identificado_por: null,
      codigo_municipal: '27001', municipio: 'Quibdó', departamento: 'Chocó', conjunto: 'Conjunto de prueba',
      fotos_total: 2, foto: foto(2, 'c'),
      fotos: [foto(2, 'c'), foto(22, 'd', 'Luis')],
      marcas_revision: ['incertidumbre_no_informada', 'sin_clave_especie'],
      marcas_gbif: ['TAXON_ID_NOT_FOUND', 'COLLECTION_MATCH_FUZZY'],
      institution_code: 'INST', collection_code: 'COL', catalog_number: 'CAT-1', occurrence_id: 'occ-g2', nombre_original: 'Nombre original',
      taxonomia: { reino: 'Animalia', clase: 'Amphibia', orden: 'Anura', familia: 'Bufonidae', genero: 'Rhinella' },
      latitud: 5.7, longitud: -76.6, coordenadas_ocultas: false,
    });
  });

  it('privacidad: la amenazada oculta sus coordenadas también en el detalle', async () => {
    await sembrar();
    const r = await registro('g1', 'anfibios');
    expect(r).toMatchObject({ latitud: null, longitud: null, incertidumbre_m: null, coordenadas_ocultas: true, amenaza: 'CR' });
    expect(JSON.stringify(r)).not.toContain('5.69');
    expect(JSON.stringify(r)).not.toContain('-76.65');
  });

  it('privacidad: sin cruce activo el detalle no entrega coordenadas', async () => {
    await sembrar({ cruceActivo: false });
    const r = await registro('g2', 'anfibios');
    expect(r).toMatchObject({ latitud: null, longitud: null, coordenadas_ocultas: true });
  });

  it('descarta las fotos inválidas y nunca devuelve la URL original', async () => {
    await sembrar();
    const r = await registro('g1', 'anfibios');
    expect(r.fotos).toEqual([foto(1, 'a'), foto(11, 'b')]);
    expect(r.fotos_total).toBe(2);
    expect(JSON.stringify(r)).not.toMatch(/amazonaws|original\.jpeg/);
    expect((await registro('g6', 'anfibios')).fotos).toEqual([]);
  });

  it('marcas_gbif: solo códigos con forma válida; vacío si no hay detalle o no hay marcas', async () => {
    await sembrar();
    expect((await registro('g1', 'anfibios')).marcas_gbif).toEqual(['COORDINATE_ROUNDED']);
    expect((await registro('g2', 'anfibios')).marcas_gbif).toEqual(['TAXON_ID_NOT_FOUND', 'COLLECTION_MATCH_FUZZY']);
    expect((await registro('g4', 'anfibios')).marcas_gbif).toEqual([]);
    expect((await registro('g3', 'anfibios')).marcas_gbif).toEqual([]);
  });

  it('sin fila de detalle: fotos vacías y autores nulos', async () => {
    await sembrar();
    expect(await registro('g3', 'anfibios')).toMatchObject({ fotos: [], fotos_total: 0, foto: null, registrado_por: null, identificado_por: null });
  });

  it('sin marcas de revisión devuelve un arreglo vacío', async () => {
    await sembrar();
    await query(`UPDATE biodiversidad.registro SET marcas_revision = NULL WHERE gbif_id = 'g3'`);
    await query(`UPDATE biodiversidad.registro SET marcas_revision = '' WHERE gbif_id = 'g2'`);
    expect((await registro('g3', 'anfibios')).marcas_revision).toEqual([]);
    expect((await registro('g2', 'anfibios')).marcas_revision).toEqual([]);
  });

  it('un registro en varios municipios devuelve el primero', async () => {
    await sembrar();
    expect(await registro('g6', 'anfibios')).toMatchObject({ codigo_municipal: '05045', municipio: 'Apartadó' });
  });

  it('null si no existe en el corte activo del grupo (o el grupo no tiene datos)', async () => {
    await sembrar();
    expect(await registro('999', 'anfibios')).toBeNull();
    expect(await registro('g1', 'hongos')).toBeNull();
    await query('UPDATE biodiversidad.lote SET activo = false WHERE grupo = $1', ['anfibios']);
    expect(await registro('g1', 'anfibios')).toBeNull();
  });

  it('un grupo agregado responde ConsultaInvalida (422)', async () => {
    await sembrar();
    await expect(registro('g1', 'aves')).rejects.toBeInstanceOf(ConsultaInvalida);
  });

  it('el identificador es un dato, no SQL', async () => {
    await sembrar();
    expect(await registro("g1' OR '1'='1", 'anfibios')).toBeNull();
  });
});

describe('series()', () => {
  it('individuales: por año ascendente y por tipo de evidencia descendente', async () => {
    await sembrar();
    const r = await series({ grupo: 'anfibios' });
    expect(r).toMatchObject({ grupo: 'anfibios', metodo: 'individual' });
    expect(r.por_anio).toEqual([
      { anio: 2010, registros: 1 }, { anio: 2015, registros: 1 }, { anio: 2020, registros: 1 }, { anio: 2021, registros: 2 }, { anio: 2022, registros: 1 },
    ]);
    expect(r.por_evidencia).toEqual([{ tipo: 'HUMAN_OBSERVATION', registros: 3 }, { tipo: 'PRESERVED_SPECIMEN', registros: 3 }]);
  });

  it('respeta el alcance sin contar dos veces un registro de dos municipios', async () => {
    await sembrar();
    const r = await series({ grupo: 'anfibios', departamento: 'Chocó' });
    expect(r.por_anio.reduce((s, x) => s + x.registros, 0)).toBe(5);
    const a = await series({ grupo: 'anfibios', codigo_municipal: '05045' });
    expect(a.por_anio).toEqual([{ anio: 2015, registros: 1 }, { anio: 2022, registros: 1 }]);
  });

  it('agregados: desde las facetas del municipio', async () => {
    await sembrar();
    const r = await series({ grupo: 'aves' });
    expect(r.por_anio).toEqual([{ anio: 2020, registros: 500 }, { anio: 2024, registros: 200 }]);
    expect(r.por_evidencia).toEqual([{ tipo: 'HUMAN_OBSERVATION', registros: 650 }, { tipo: 'MACHINE_OBSERVATION', registros: 50 }]);
    const ant = await series({ grupo: 'aves', departamento: 'Antioquia' });
    expect(ant.por_evidencia).toEqual([{ tipo: 'HUMAN_OBSERVATION', registros: 150 }, { tipo: 'MACHINE_OBSERVATION', registros: 50 }]);
  });

  it('null si el grupo no tiene lote activo', async () => {
    await sembrar();
    expect(await series({ grupo: 'hongos' })).toBeNull();
  });
});
