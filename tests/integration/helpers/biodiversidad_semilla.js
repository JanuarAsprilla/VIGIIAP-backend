/**
 * Semilla compartida de las pruebas de integración de filtros (API v2.2).
 * Lote individual `anfibios` (8 registros con taxonomía, entidad, evidencia, fotos y ubicación variadas) y lote
 * agregado `aves`. La tabla REGISTROS es la fuente de verdad: las pruebas derivan de ella lo esperado en cada ruta.
 */
import { query } from '../../../src/config/database.js';

export const E1 = '11111111-1111-4111-8111-111111111111';
export const E2 = '22222222-2222-4222-8222-222222222222';
export const DS1 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
export const DS2 = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

const img = (n) => `https://api.gbif.org/v1/image/cache/500x/occurrence/${n}/media/${String(n).padStart(32, 'a').slice(0, 32)}`;
const foto = (n) => ({ imagen: img(n), autor: 'Ana', editor: 'iNat', licencia: 'CC-BY', referencia: `https://www.inaturalist.org/photos/${n}` });
const FOTO_S3 = { imagen: 'https://inaturalist-open-data.s3.amazonaws.com/photos/1/original.jpeg', autor: 'X', editor: 'Y', licencia: 'L', referencia: 'https://www.inaturalist.org/photos/9' };

/** especie: clave de especie (null = solo género). oculto: coordenadas reservadas (amenazada o sin especie). */
export const TAXONES = {
  tx1: { sp: '1', nombre: 'Pristimantis amenazado', clase: 'Amphibia', orden: 'Anura', familia: 'Craugastoridae', genero: 'Pristimantis' },
  tx2: { sp: '2', nombre: 'Rhinella común', clase: 'Amphibia', orden: 'Anura', familia: 'Bufonidae', genero: 'Rhinella' },
  tx3: { sp: '3', nombre: 'Atelopus endémico', clase: 'Amphibia', orden: 'Anura', familia: 'Bufonidae', genero: 'Atelopus' },
  tx4: { sp: '4', nombre: 'Eleutherodactylus invasor', clase: 'Amphibia', orden: 'Anura', familia: 'Eleutherodactylidae', genero: 'Eleutherodactylus' },
  tx5: { sp: '5', nombre: 'Caecilia gimnopis', clase: 'Amphibia', orden: 'Gymnophiona', familia: 'Caeciliidae', genero: 'Caecilia' },
  tx6: { sp: null, nombre: null, clase: 'Amphibia', orden: 'Anura', familia: 'Craugastoridae', genero: 'Pristimantis' },
  tx7: { sp: '7', nombre: 'Anolis de prueba', clase: 'Reptilia', orden: 'Squamata', familia: 'Dactyloidae', genero: 'Anolis' },
};

/** Registros del lote individual. `m` = municipios asignados. */
export const REGISTROS = [
  { id: 'g1', tx: 'tx1', anio: 2020, lat: 5.69, lon: -76.65, m: ['27001'], ds: DS1, ev: 'HUMAN_OBSERVATION', fotos: [foto(1), FOTO_S3], oculto: true },
  { id: 'g2', tx: 'tx2', anio: 2021, lat: 5.70, lon: -76.60, m: ['27001'], ds: DS1, ev: 'PRESERVED_SPECIMEN', fotos: [foto(2), foto(22)] },
  { id: 'g3', tx: 'tx2', anio: 2015, lat: 7.88, lon: -76.63, m: ['05045'], ds: DS2, ev: 'HUMAN_OBSERVATION', fotos: [] },
  { id: 'g4', tx: 'tx3', anio: 2021, lat: 5.71, lon: -76.61, m: ['27001'], ds: DS1, ev: 'PRESERVED_SPECIMEN', fotos: [foto(4)] },
  { id: 'g5', tx: 'tx6', anio: 2010, lat: 5.72, lon: -76.62, m: ['27001'], ds: DS1, ev: 'HUMAN_OBSERVATION', fotos: [], oculto: true },
  { id: 'g6', tx: 'tx4', anio: 2022, lat: 5.73, lon: -76.63, m: ['27001', '05045'], ds: DS2, ev: 'PRESERVED_SPECIMEN', fotos: [FOTO_S3] },
  { id: 'g7', tx: 'tx5', anio: 2018, lat: 6.10, lon: -76.70, m: ['27099'], ds: DS2, ev: 'HUMAN_OBSERVATION', fotos: [foto(7)], oculto: true },
  { id: 'g8', tx: 'tx7', anio: 2023, lat: 5.74, lon: -76.64, m: ['27099'], ds: DS2, ev: 'MACHINE_OBSERVATION', fotos: [] },
];

export const MUNICIPIOS = [
  ['27001', 'Quibdó', 'Chocó'], ['05045', 'Apartadó', 'Antioquia'], ['27099', 'Bojayá', 'Chocó'],
];

export const ENTIDAD_DE = { [DS1]: E1, [DS2]: E2 };
export const publico = (r) => !r.oculto;
export const idsDe = (lista) => lista.map((r) => r.id).sort();
export const especieDe = (r) => TAXONES[r.tx].sp;

export async function limpiar() {
  await query(`TRUNCATE biodiversidad.clasificacion, biodiversidad.territorio_version,
    biodiversidad.entidad, biodiversidad.conjunto, biodiversidad.conservacion_importacion
    RESTART IDENTITY CASCADE`);
}

async function insertarLote(grupo, metodo, huella, n) {
  const { rows: [l] } = await query(
    `INSERT INTO biodiversidad.lote (grupo, metodo, clasificacion_clave, territorio_huella, desde, hasta, huella_fuente, origen, registros, estado, activo)
     VALUES ($1, $2, 'bb', 't1', 2000, 2025, $3, 'prueba', $4, 'completo', true) RETURNING id`, [grupo, metodo, huella, n]);
  return l.id;
}

async function afirmar(importacion, tema, valor, especie) {
  const { rows: [af] } = await query(
    `INSERT INTO biodiversidad.conservacion_afirmacion (importacion_id, fuente, nombre, tema, valor) VALUES ($1, 'f', 'n', $2, $3) RETURNING id`,
    [importacion, tema, valor]);
  await query(`INSERT INTO biodiversidad.conservacion_vinculo VALUES ($1, 'bb', $2, 'nombre_exacto')`, [af.id, especie]);
}

async function sembrarBase() {
  await query(`INSERT INTO biodiversidad.clasificacion VALUES ('bb', 'GBIF Backbone')`);
  await query(`INSERT INTO biodiversidad.territorio_version (huella, origen) VALUES ('t1', 'prueba')`);
  for (const [c, n, d] of MUNICIPIOS) await query(`INSERT INTO biodiversidad.municipio VALUES ('t1', $1, $2, $3)`, [c, n, d]);
  await query(`INSERT INTO biodiversidad.entidad (clave, nombre) VALUES ($1, 'Entidad Uno'), ($2, 'Entidad Dos')`, [E1, E2]);
  await query(
    `INSERT INTO biodiversidad.conjunto (clave, titulo, entidad_clave) VALUES ($1, 'Conjunto uno', $3), ($2, 'Conjunto dos', $4)`,
    [DS1, DS2, E1, E2]);
}

async function sembrarTaxones() {
  const todos = { ...TAXONES,
    a1: { sp: '11', nombre: 'Ave uno', clase: 'Aves', orden: 'Passeriformes', familia: 'Thraupidae', genero: 'Tangara' },
    a2: { sp: '12', nombre: 'Ave dos', clase: 'Aves', orden: 'Passeriformes', familia: 'Tyrannidae', genero: 'Pitangus' },
    a3: { sp: '13', nombre: 'Ave tres', clase: 'Aves', orden: 'Apodiformes', familia: 'Trochilidae', genero: 'Amazilia' },
  };
  for (const [huella, t] of Object.entries(todos)) {
    await query(
      `INSERT INTO biodiversidad.taxon_version (huella, clasificacion_clave, taxon_clave, rango, nombre_cientifico, reino, division, clase, orden, familia, genero, especie_clave, especie, linaje)
       VALUES ($1, 'bb', $1, 'SPECIES', $2, 'Animalia', 'Chordata', $3, $4, $5, $6, $7, $2, '{}')`,
      [huella, t.nombre, t.clase, t.orden, t.familia, t.genero, t.sp]);
  }
}

async function sembrarRegistros(lote) {
  for (const r of REGISTROS) {
    await query(
      `INSERT INTO biodiversidad.registro (lote_id, gbif_id, dataset_key, taxon_huella, anio, fecha_evento, latitud, longitud, incertidumbre_m, tipo_evidencia, licencia, vista_1000m)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 25, $9, 'CC_BY_4_0', true)`,
      [lote, r.id, r.ds, r.tx, r.anio, `${r.anio}-03-04`, r.lat, r.lon, r.ev]);
    for (const c of r.m) await query(`INSERT INTO biodiversidad.asignacion VALUES ($1, $2, 't1', $3)`, [lote, r.id, c]);
    if (r.fotos.length) {
      await query(`INSERT INTO biodiversidad.registro_detalle (lote_id, gbif_id, fotos) VALUES ($1, $2, $3::jsonb)`, [lote, r.id, JSON.stringify(r.fotos)]);
    }
  }
}

async function sembrarAves(lote) {
  await query(
    `INSERT INTO biodiversidad.resumen_territorial VALUES ($1, 't1', '27001', 500, 3), ($1, 't1', '05045', 250, 0), ($1, 't1', '27099', 30, 0)`, [lote]);
  await query(
    `INSERT INTO biodiversidad.inventario_especie VALUES ($1, '27001', 'a1', 100), ($1, '27001', 'a2', 400),
       ($1, '05045', 'a2', 200), ($1, '05045', 'a3', 50), ($1, '27099', 'a3', 30)`, [lote]);
  await query(
    `INSERT INTO biodiversidad.conteo_fuente VALUES ($1, '27001', $2, 300), ($1, '27001', $3, 200), ($1, '05045', $3, 250), ($1, '27099', $3, 30)`,
    [lote, DS1, DS2]);
  await query(
    `INSERT INTO biodiversidad.faceta_municipal VALUES ($1, '27001', 'anio', '2020', 300), ($1, '27001', 'anio', '2024', 200),
       ($1, '05045', 'anio', '2020', 250), ($1, '27099', 'anio', '2024', 30),
       ($1, '27001', 'tipo_evidencia', 'HUMAN_OBSERVATION', 500), ($1, '05045', 'tipo_evidencia', 'HUMAN_OBSERVATION', 200),
       ($1, '05045', 'tipo_evidencia', 'MACHINE_OBSERVATION', 50), ($1, '27099', 'tipo_evidencia', 'HUMAN_OBSERVATION', 30)`, [lote]);
}

/** Cruce de conservación: sp1 CR (y VU), sp5 EN, sp3 endémica, sp4 introducida e invasora, sp11 VU (ave). */
async function sembrarConservacion() {
  const { rows: [imp] } = await query(`INSERT INTO biodiversidad.conservacion_importacion (huella, activo) VALUES ('c1', true) RETURNING id`);
  await afirmar(imp.id, 'amenaza_nacional', 'VU', '1');
  await afirmar(imp.id, 'amenaza_nacional', 'CR', '1');
  await afirmar(imp.id, 'amenaza_nacional', 'EN', '5');
  await afirmar(imp.id, 'amenaza_nacional', 'VU', '11');
  await afirmar(imp.id, 'endemismo_colombia', 'Endémica', '3');
  await afirmar(imp.id, 'endemismo_choco_reportado', 'Reportada', '3');
  await afirmar(imp.id, 'introducida', 'Alien', '4');
  await afirmar(imp.id, 'invasora_declarada', 'Invasora declarada', '4');
}

export async function sembrar({ cruceActivo = true } = {}) {
  await sembrarBase();
  await sembrarTaxones();
  const ind = await insertarLote('anfibios', 'individual', 'h1', REGISTROS.length);
  const agr = await insertarLote('aves', 'agregado', 'h2', 780);
  await sembrarRegistros(ind);
  await query(`INSERT INTO biodiversidad.resumen_territorial VALUES ($1, 't1', '27001', 5, 1), ($1, 't1', '05045', 2, 0), ($1, 't1', '27099', 2, 0)`, [ind]);
  await sembrarAves(agr);
  if (cruceActivo) await sembrarConservacion();
}
