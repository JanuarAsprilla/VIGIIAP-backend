/**
 * Filtros transversales (API v2.2) en grupos individuales: cada filtro actúa igual en municipios, resumen,
 * series, especies, registros y puntos. Lo esperado se deriva de la tabla REGISTROS de la semilla.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { query } from '../../src/config/database.js';
import {
  municipios, registros, resumen, series, especies, puntos,
} from '../../src/modules/biodiversidad/biodiversidad.service.js';
import {
  sembrar, limpiar, REGISTROS, TAXONES, MUNICIPIOS, E1, E2, DS1, DS2, idsDe, especieDe, publico,
} from './helpers/biodiversidad_semilla.js';

// Los datos son de solo lectura: se siembran una vez por archivo (TRUNCATE es lento).
beforeAll(async () => { await limpiar(); await sembrar(); });
afterAll(limpiar);

const G = { grupo: 'anfibios' };
const tx = (r) => TAXONES[r.tx];
const CASOS = [
  ['reino', { reino: 'Plantae' }, () => false],
  ['reino', { reino: 'Animalia' }, () => true],
  ['division', { division: 'Chordata' }, () => true],
  ['clase', { clase: 'Reptilia' }, (r) => tx(r).clase === 'Reptilia'],
  ['clase', { clase: 'Amphibia' }, (r) => tx(r).clase === 'Amphibia'],
  ['orden', { orden_taxon: 'Gymnophiona' }, (r) => tx(r).orden === 'Gymnophiona'],
  ['familia', { familia: 'Bufonidae' }, (r) => tx(r).familia === 'Bufonidae'],
  ['genero', { genero: 'Pristimantis' }, (r) => tx(r).genero === 'Pristimantis'],
  ['especie_clave', { especie_clave: '2' }, (r) => especieDe(r) === '2'],
  ['buscar', { buscar: 'COMUN' }, (r) => especieDe(r) === '2'],
  ['conservacion amenazada', { conservacion: 'amenazada' }, (r) => ['1', '5'].includes(especieDe(r))],
  ['conservacion endemica', { conservacion: 'endemica' }, (r) => especieDe(r) === '3'],
  ['conservacion introducida', { conservacion: 'introducida' }, (r) => especieDe(r) === '4'],
  ['conservacion invasora', { conservacion: 'invasora' }, (r) => especieDe(r) === '4'],
  ['amenaza CR', { amenaza: 'CR' }, (r) => especieDe(r) === '1'],
  ['amenaza EN', { amenaza: 'EN' }, (r) => especieDe(r) === '5'],
  ['amenaza VU', { amenaza: 'VU' }, () => false],
  ['entidad E1', { entidad_clave: E1 }, (r) => r.ds === DS1],
  ['entidad E2', { entidad_clave: E2 }, (r) => r.ds === DS2],
  ['dataset DS1', { dataset_key: DS1 }, (r) => r.ds === DS1],
  ['anio_desde', { anio_desde: 2021 }, (r) => r.anio >= 2021],
  ['anio_hasta', { anio_hasta: 2015 }, (r) => r.anio <= 2015],
  ['rango de años', { anio_desde: 2018, anio_hasta: 2021 }, (r) => r.anio >= 2018 && r.anio <= 2021],
  ['tipo_evidencia', { tipo_evidencia: 'PRESERVED_SPECIMEN' }, (r) => r.ev === 'PRESERVED_SPECIMEN'],
  ['tipo_evidencia máquina', { tipo_evidencia: 'MACHINE_OBSERVATION' }, (r) => r.ev === 'MACHINE_OBSERVATION'],
  ['con_foto', { con_foto: true }, (r) => ['g1', 'g2', 'g4', 'g7'].includes(r.id)],
  ['con_ubicacion', { con_ubicacion: true }, publico],
  ['departamento', { departamento: 'Antioquia' }, (r) => r.m.includes('05045')],
  ['municipio', { codigo_municipal: '27099' }, (r) => r.m.includes('27099')],
  ['combinado', { familia: 'Bufonidae', anio_desde: 2021, dataset_key: DS1, departamento: 'Chocó' }, (r) => ['g2', 'g4'].includes(r.id)],
  ['sin coincidencias', { familia: 'Bufonidae', clase: 'Reptilia' }, () => false],
];
const esperados = (pred) => REGISTROS.filter(pred);
const PAG = { pagina: 1, tamano: 100 };

describe.each(CASOS)('filtro %s', (_n, filtros, pred) => {
  const esp = esperados(pred);

  it('registros devuelve exactamente los esperados y el total coincide', async () => {
    const r = await registros({ ...G, ...PAG, ...filtros });
    expect(r.registros.map((x) => x.gbif_id).sort()).toEqual(idsDe(esp));
    expect(r.total).toBe(esp.length);
  });

  it('resumen recalcula registros, especies, fotos, ubicación y conjuntos', async () => {
    const r = await resumen({ ...G, ...filtros });
    expect(r.registros).toBe(esp.length);
    expect(r.especies).toBe(new Set(esp.map(especieDe).filter(Boolean)).size);
    expect(r.con_ubicacion).toBe(esp.filter(publico).length);
    expect(r.con_foto).toBe(esp.filter((x) => ['g1', 'g2', 'g4', 'g7'].includes(x.id)).length);
    expect(r.conjuntos).toBe(new Set(esp.map((x) => x.ds)).size);
    expect(r.entidades).toBe(new Set(esp.map((x) => x.ds)).size);
    expect(r.anio_min).toBe(esp.length ? Math.min(...esp.map((x) => x.anio)) : null);
  });

  it('especies lista solo las especies de los registros esperados', async () => {
    const r = await especies({ ...G, ...PAG, orden: 'registros', ...filtros });
    const claves = new Set(esp.map(especieDe).filter(Boolean));
    expect(r.especies.map((e) => e.especie_clave).sort()).toEqual([...claves].sort());
    expect(r.total).toBe(claves.size);
  });

  it('series cuenta por año y evidencia el subconjunto', async () => {
    const r = await series({ ...G, ...filtros });
    expect(r.por_anio.reduce((s, x) => s + x.registros, 0)).toBe(esp.length);
    expect(r.por_evidencia.reduce((s, x) => s + x.registros, 0)).toBe(esp.length);
  });

  it('municipios recalcula conteos; los sin coincidencias aparecen con 0', async () => {
    const r = await municipios({ ...G, ...filtros });
    const deptoOk = (m) => (filtros.departamento ? m[2] === filtros.departamento : true);
    const munOk = (m) => (filtros.codigo_municipal ? m[0] === filtros.codigo_municipal : true);
    const lista = MUNICIPIOS.filter((m) => deptoOk(m) && munOk(m));
    expect(r.municipios.map((m) => m.codigo_municipal).sort()).toEqual(lista.map((m) => m[0]).sort());
    for (const m of r.municipios) {
      const enMun = esp.filter((x) => x.m.includes(m.codigo_municipal));
      expect(m.registros, m.codigo_municipal).toBe(enMun.length);
      expect(m.sin_especie).toBe(enMun.filter((x) => !especieDe(x)).length);
      expect(m.especies).toBe(new Set(enMun.map(especieDe).filter(Boolean)).size);
    }
  });

  it('puntos devuelve las ubicaciones públicas esperadas y cuenta las reservadas', async () => {
    const r = await puntos({ ...G, limite: 1500, ...filtros });
    expect(r.puntos.map((p) => p.id).sort()).toEqual(idsDe(esp.filter(publico)));
    expect(r).toMatchObject({ total: esp.filter(publico).length, ocultos: esp.filter((x) => !publico(x)).length, muestreado: false });
  });
});

describe('compatibilidad v2', () => {
  it('municipios sin filtros conserva campos y valores almacenados, orden por departamento y nombre', async () => {
    const r = await municipios(G);
    expect(r.municipios.map((m) => [m.codigo_municipal, m.registros, m.sin_especie])).toEqual([['05045', 2, 0], ['27099', 2, 0], ['27001', 5, 1]]);
    expect(Object.keys(r.municipios[0]).sort()).toEqual(['codigo_municipal', 'departamento', 'especies', 'municipio', 'registros', 'sin_especie']);
  });

  it('resumen conserva los campos anteriores y añade entidades, conjuntos y con_ubicacion', async () => {
    const r = await resumen(G);
    expect(Object.keys(r)).toEqual(expect.arrayContaining(['grupo', 'metodo', 'alcance', 'registros', 'especies', 'con_foto', 'amenazadas',
      'endemicas_colombia', 'endemicas_choco', 'introducidas', 'invasoras', 'anio_min', 'anio_max', 'entidades', 'conjuntos', 'con_ubicacion']));
    expect(r).toMatchObject({ registros: 8, especies: 6, entidades: 2, conjuntos: 2, con_ubicacion: 5, amenazadas: { CR: 1, EN: 1, VU: 0, total: 2 } });
  });

  it('un registro asignado a dos municipios cuenta una vez en los agregados', async () => {
    expect((await resumen({ ...G, familia: 'Eleutherodactylidae' })).registros).toBe(1);
    expect((await series({ ...G, familia: 'Eleutherodactylidae' })).por_anio).toEqual([{ anio: 2022, registros: 1 }]);
  });
});

describe('/registros ordenamiento', () => {
  const orden = (o) => registros({ ...G, ...PAG, orden: o }).then((r) => r.registros.map((x) => x.gbif_id));

  it('anio_desc es el defecto, con desempate estable por gbif_id', async () => {
    expect((await registros({ ...G, ...PAG })).registros.map((x) => x.gbif_id)).toEqual(['g8', 'g6', 'g2', 'g4', 'g1', 'g7', 'g3', 'g5']);
    expect(await orden('anio_desc')).toEqual(['g8', 'g6', 'g2', 'g4', 'g1', 'g7', 'g3', 'g5']);
  });

  it('anio_asc y especie', async () => {
    expect(await orden('anio_asc')).toEqual(['g5', 'g3', 'g7', 'g1', 'g2', 'g4', 'g6', 'g8']);
    const porEspecie = await orden('especie');
    expect(porEspecie.slice(0, 3)).toEqual(['g8', 'g4', 'g7']);
    expect(porEspecie.at(-1)).toBe('g5');
  });

  it('paginando no se repiten ni se pierden registros', async () => {
    const a = await registros({ ...G, pagina: 1, tamano: 3, orden: 'anio_desc' });
    const b = await registros({ ...G, pagina: 2, tamano: 3, orden: 'anio_desc' });
    const c = await registros({ ...G, pagina: 3, tamano: 3, orden: 'anio_desc' });
    expect([...a.registros, ...b.registros, ...c.registros].map((x) => x.gbif_id)).toEqual(['g8', 'g6', 'g2', 'g4', 'g1', 'g7', 'g3', 'g5']);
  });
});

describe('/especies orden=municipios y fotos con filtros', () => {
  it('ordena por número de municipios y luego por registros', async () => {
    const r = await especies({ ...G, ...PAG, orden: 'municipios' });
    expect(r.especies.slice(0, 2).map((e) => [e.especie_clave, e.municipios, e.registros])).toEqual([['2', 2, 2], ['4', 2, 1]]);
  });

  it('la foto y fotos_total respetan los demás filtros (año)', async () => {
    const r = await especies({ ...G, ...PAG, orden: 'nombre', especie_clave: '2', anio_hasta: 2015 });
    expect(r.especies[0]).toMatchObject({ especie_clave: '2', registros: 1, foto: null, fotos_total: 0 });
  });
});

describe('/puntos', () => {
  const P = { ...G, limite: 1500 };

  it('nunca devuelve ubicación reservada: amenazadas, sin especie ni sin cruce activo', async () => {
    const r = await puntos(P);
    expect(r.puntos.map((p) => p.id).sort()).toEqual(['g2', 'g3', 'g4', 'g6', 'g8']);
    for (const p of r.puntos) {
      expect(Object.keys(p).sort()).toEqual(['a', 'e', 'ek', 'id', 'lat', 'lon']);
      expect(typeof p.lat).toBe('number');
      expect(typeof p.lon).toBe('number');
    }
    expect(r).toMatchObject({ total: 5, mostrados: 5, ocultos: 3, muestreado: false });
    expect(JSON.stringify(r)).not.toMatch(/5\.69|-76\.65|"g1"|"g5"|"g7"/);
  });

  it('sin cruce de conservación activo todas las ubicaciones están reservadas', async () => {
    await limpiar();
    await sembrar({ cruceActivo: false });
    try {
      const r = await puntos(P);
      expect(r).toMatchObject({ total: 0, mostrados: 0, ocultos: 8, puntos: [] });
    } finally {
      await limpiar();
      await sembrar();
    }
  });

  it('entrega especie, clave y coordenadas de los públicos', async () => {
    const r = await puntos({ ...P, especie_clave: '2' });
    expect(r.puntos.find((p) => p.id === 'g2')).toEqual({ id: 'g2', lat: 5.7, lon: -76.6, e: 'Rhinella común', ek: '2', a: null });
  });

  it('bbox acota total y mostrados pero no los ocultos', async () => {
    const r = await puntos({ ...P, bbox: [-76.7, 5.6, -76.5, 5.8] });
    expect(r.puntos.map((p) => p.id).sort()).toEqual(['g2', 'g4', 'g6', 'g8']);
    expect(r).toMatchObject({ total: 4, mostrados: 4, ocultos: 3 });
  });

  it('muestreo determinista: misma muestra en cada llamada, ordenada por md5(gbif_id)', async () => {
    const a = await puntos({ ...P, limite: 2 });
    const b = await puntos({ ...P, limite: 2 });
    expect(a).toEqual(b);
    expect(a).toMatchObject({ total: 5, mostrados: 2, muestreado: true });
    const { rows } = await query(`SELECT x FROM unnest(ARRAY['g2','g3','g4','g6','g8']) x ORDER BY md5(x), x LIMIT 2`);
    expect(a.puntos.map((p) => p.id)).toEqual(rows.map((r) => r.x));
  });

  it('limite igual al total no marca muestreado', async () => {
    expect((await puntos({ ...P, limite: 5 })).muestreado).toBe(false);
  });

  it('un grupo agregado responde ConsultaInvalida y uno sin datos null', async () => {
    await expect(puntos({ grupo: 'aves', limite: 10 })).rejects.toMatchObject({ status: 422 });
    expect(await puntos({ grupo: 'hongos', limite: 10 })).toBeNull();
  });
});

describe('inyección SQL', () => {
  const MALOS = ["x' OR '1'='1", "'; DROP TABLE biodiversidad.registro; --", '") OR 1=1 --', '\\', '%', '_'];

  it('taxonomía, buscar, tipo_evidencia, departamento y entidad son datos, no SQL', async () => {
    for (const m of MALOS) {
      for (const campo of ['reino', 'division', 'clase', 'orden_taxon', 'familia', 'genero', 'tipo_evidencia', 'especie_clave', 'departamento', 'buscar', 'entidad_clave', 'dataset_key']) {
        const f = { ...G, [campo]: m };
        expect((await registros({ ...PAG, ...f })).total, `${campo} ${m}`).toBe(0);
        expect((await resumen(f)).registros).toBe(0);
        expect((await puntos({ ...f, limite: 10 })).total).toBe(0);
      }
    }
    expect((await query('SELECT count(*)::int AS n FROM biodiversidad.registro')).rows[0].n).toBe(8);
  });

  it('bbox llega solo como números', async () => {
    const r = await puntos({ ...G, limite: 10, bbox: [-77, 5, -76, 6] });
    expect(r.total).toBeGreaterThan(0);
  });
});
