/**
 * /opciones (facetas en cascada) y reglas de los grupos de inventario agregado (aves, insectos, plantas).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  municipios, registros, resumen, series, especies, opciones,
} from '../../src/modules/biodiversidad/biodiversidad.service.js';
import { sembrar, limpiar, E1, E2, DS1, DS2 } from './helpers/biodiversidad_semilla.js';

beforeAll(async () => { await limpiar(); await sembrar(); });
afterAll(limpiar);

const op = (campo, extra = {}, grupo = 'anfibios') => opciones({ grupo, campo, limite: 100, ...extra });
const pares = (r) => r.valores.map((v) => [v.valor, v.registros]);

describe('opciones — individuales', () => {
  it('forma de la respuesta y orden por registros descendente', async () => {
    const r = await op('clase');
    expect(r).toEqual({ grupo: 'anfibios', campo: 'clase', valores: [
      { valor: 'Amphibia', nombre: 'Amphibia', registros: 7 }, { valor: 'Reptilia', nombre: 'Reptilia', registros: 1 }] });
  });

  it('cascada: orden depende de clase; familia depende de orden', async () => {
    expect(pares(await op('orden', { clase: 'Amphibia' }))).toEqual([['Anura', 6], ['Gymnophiona', 1]]);
    expect(pares(await op('orden', { clase: 'Reptilia' }))).toEqual([['Squamata', 1]]);
    expect(pares(await op('familia', { orden_taxon: 'Anura' }))).toEqual([['Bufonidae', 3], ['Craugastoridae', 2], ['Eleutherodactylidae', 1]]);
    expect(pares(await op('familia', { clase: 'Reptilia' }))).toEqual([['Dactyloidae', 1]]);
    expect(pares(await op('genero', { familia: 'Bufonidae' }))).toEqual([['Rhinella', 2], ['Atelopus', 1]]);
  });

  it('excluye el filtro del propio campo para poder cambiar de opción', async () => {
    expect(pares(await op('familia', { orden_taxon: 'Anura', familia: 'Bufonidae' })).map((p) => p[0]))
      .toEqual(['Bufonidae', 'Craugastoridae', 'Eleutherodactylidae']);
    expect(pares(await op('clase', { clase: 'Reptilia' })).map((p) => p[0])).toEqual(['Amphibia', 'Reptilia']);
  });

  it('ignora filtros de rangos inferiores y de especie al listar un rango superior', async () => {
    expect(pares(await op('familia', { orden_taxon: 'Anura', genero: 'Atelopus', especie_clave: '3' })).length).toBe(3);
    expect(pares(await op('orden', { clase: 'Amphibia', familia: 'Bufonidae' }))).toEqual([['Anura', 6], ['Gymnophiona', 1]]);
  });

  it('respeta los demás filtros activos (territorio, año, evidencia)', async () => {
    expect(pares(await op('clase', { departamento: 'Antioquia' }))).toEqual([['Amphibia', 2]]);
    expect(pares(await op('familia', { orden_taxon: 'Anura', anio_desde: 2021 }))).toEqual([['Bufonidae', 2], ['Eleutherodactylidae', 1]]);
    expect(pares(await op('clase', { tipo_evidencia: 'MACHINE_OBSERVATION' }))).toEqual([['Reptilia', 1]]);
    expect(pares(await op('clase', { conservacion: 'amenazada' }))).toEqual([['Amphibia', 2]]);
  });

  it('un registro asignado a dos municipios cuenta una vez', async () => {
    expect(pares(await op('familia', { orden_taxon: 'Anura' }))).toContainEqual(['Eleutherodactylidae', 1]);
  });

  it('entidad y conjunto traen la etiqueta legible; conjunto respeta la entidad elegida', async () => {
    expect((await op('entidad')).valores).toEqual([
      { valor: E2, nombre: 'Entidad Dos', registros: 4 }, { valor: E1, nombre: 'Entidad Uno', registros: 4 }]);
    expect((await op('conjunto', { entidad_clave: E1 })).valores).toEqual([{ valor: DS1, nombre: 'Conjunto uno', registros: 4 }]);
    expect((await op('entidad', { entidad_clave: E1, dataset_key: DS1 })).valores.map((v) => v.valor)).toEqual([E2, E1]);
    expect((await op('conjunto', { dataset_key: DS1 })).valores.map((v) => v.valor)).toEqual([DS2, DS1]);
  });

  it('tipo de evidencia y año', async () => {
    expect(pares(await op('tipo_evidencia', { familia: 'Bufonidae' }))).toEqual([['PRESERVED_SPECIMEN', 2], ['HUMAN_OBSERVATION', 1]]);
    const anios = await op('anio', { familia: 'Bufonidae', anio_desde: 2021 });
    expect(pares(anios).sort()).toEqual([['2015', 1], ['2021', 2]].sort());
    expect(anios.valores.find((v) => v.valor === '2021').nombre).toBe('2021');
  });

  it('buscar filtra por etiqueta sin acentos ni mayúsculas y escapa comodines; limite acota', async () => {
    expect(pares(await op('familia', { buscar: 'BUFO' }))).toEqual([['Bufonidae', 3]]);
    expect(pares(await op('entidad', { buscar: 'dos' }))).toEqual([[E2, 4]]);
    expect((await op('familia', { buscar: '%%' })).valores).toEqual([]);
    expect((await op('familia', { limite: 2 })).valores.length).toBe(2);
  });

  it('inyección en los filtros y en buscar no altera la consulta', async () => {
    for (const m of ["x' OR '1'='1", "'; DROP TABLE biodiversidad.registro; --"]) {
      expect((await op('familia', { buscar: m })).valores).toEqual([]);
      expect((await op('familia', { orden_taxon: m })).valores).toEqual([]);
    }
  });

  it('omite valores nulos de la taxonomía y devuelve null sin lote', async () => {
    expect(await op('clase', {}, 'hongos')).toBeNull();
  });
});

describe('reglas de grupos agregados', () => {
  const A = { grupo: 'aves' };
  const pag = { pagina: 1, tamano: 50 };
  const rechaza = (p) => expect(p).rejects.toMatchObject({ name: 'ConsultaInvalida', status: 422 });

  it('municipios sin filtros conserva los valores almacenados', async () => {
    const r = await municipios(A);
    expect(r.municipios.map((m) => [m.codigo_municipal, m.registros, m.sin_especie, m.especies])).toEqual([['05045', 250, 0, 2], ['27099', 30, 0, 1], ['27001', 500, 3, 2]]);
  });

  it('municipios con taxonomía recalcula desde el inventario', async () => {
    const r = await municipios({ ...A, familia: 'Tyrannidae' });
    expect(r.municipios.map((m) => [m.codigo_municipal, m.registros, m.especies])).toEqual([['05045', 200, 1], ['27099', 0, 0], ['27001', 400, 1]]);
    const o = await municipios({ ...A, orden_taxon: 'Apodiformes', departamento: 'Chocó' });
    expect(o.municipios.map((m) => [m.codigo_municipal, m.registros])).toEqual([['27099', 30], ['27001', 0]]);
    const c = await municipios({ ...A, amenaza: 'VU' });
    expect(c.municipios.map((m) => [m.codigo_municipal, m.registros])).toEqual([['05045', 0], ['27099', 0], ['27001', 100]]);
  });

  it('municipios por entidad o conjunto sale de conteo_fuente (sin especies)', async () => {
    const r = await municipios({ ...A, entidad_clave: E1 });
    expect(r.municipios.map((m) => [m.codigo_municipal, m.registros, m.especies])).toEqual([['05045', 0, null], ['27099', 0, null], ['27001', 300, null]]);
    const d = await municipios({ ...A, dataset_key: DS2 });
    expect(d.municipios.map((m) => m.registros)).toEqual([250, 30, 200]);
  });

  it('entidad/conjunto combinados con especie o taxonomía → 422', async () => {
    await rechaza(municipios({ ...A, entidad_clave: E1, familia: 'Tyrannidae' }));
    await rechaza(resumen({ ...A, dataset_key: DS1, buscar: 'ave' }));
    await rechaza(resumen({ ...A, dataset_key: DS1, conservacion: 'amenazada' }));
  });

  it('año, evidencia, foto y ubicación → 422 («no aplica»)', async () => {
    for (const f of [{ anio_desde: 2000 }, { anio_hasta: 2030 }, { tipo_evidencia: 'HUMAN_OBSERVATION' }, { con_foto: true }, { con_ubicacion: true }]) {
      await rechaza(municipios({ ...A, ...f }));
      await rechaza(resumen({ ...A, ...f }));
      await rechaza(especies({ ...A, ...pag, orden: 'registros', ...f }));
    }
    await expect(resumen({ ...A, con_foto: true })).rejects.toThrow(/no aplica/);
  });

  it('entidad/conjunto fuera de municipios y resumen → 422', async () => {
    await rechaza(especies({ ...A, ...pag, orden: 'registros', entidad_clave: E1 }));
    await rechaza(series({ ...A, dataset_key: DS1 }));
    await rechaza(opciones({ ...A, campo: 'familia', limite: 10, dataset_key: DS1 }));
  });

  it('puntos y registros → 422', async () => {
    await rechaza(registros({ ...A, ...pag, orden: 'anio_desc' }));
  });

  it('resumen: sin filtros mantiene v2 y añade entidades/conjuntos desde conteo_fuente', async () => {
    const r = await resumen(A);
    expect(r).toMatchObject({ registros: 780, especies: 3, con_foto: null, con_ubicacion: null, entidades: 2, conjuntos: 2, anio_min: 2020, anio_max: 2024 });
    expect(r.amenazadas).toEqual({ CR: 0, EN: 0, VU: 1, total: 1 });
  });

  it('resumen con taxonomía: recalcula; entidades, conjuntos y años quedan en null', async () => {
    const r = await resumen({ ...A, familia: 'Tyrannidae' });
    expect(r).toMatchObject({ registros: 600, especies: 1, entidades: null, conjuntos: null, anio_min: null, anio_max: null, con_ubicacion: null });
    expect(r.amenazadas.total).toBe(0);
    expect((await resumen({ ...A, conservacion: 'amenazada' })).registros).toBe(100);
  });

  it('resumen por entidad: registros de la fuente; especies y conservación en null', async () => {
    const r = await resumen({ ...A, entidad_clave: E1 });
    expect(r).toMatchObject({ registros: 300, especies: null, entidades: 1, conjuntos: 1 });
    expect(r.amenazadas).toEqual({ CR: null, EN: null, VU: null, total: null });
    const d = await resumen({ ...A, dataset_key: DS2, departamento: 'Chocó' });
    expect(d).toMatchObject({ registros: 230, conjuntos: 1 });
  });

  it('especies con taxonomía y orden por municipios', async () => {
    const r = await especies({ ...A, ...pag, orden: 'municipios', clase: 'Aves' });
    expect(r.especies.map((e) => e.especie_clave)).toEqual(['12', '13', '11']);
    expect((await especies({ ...A, ...pag, orden: 'registros', familia: 'Trochilidae' })).especies.map((e) => [e.especie_clave, e.registros])).toEqual([['13', 80]]);
  });

  it('series: territorio, año y evidencia propios; no se cruza con especie', async () => {
    const r = await series({ ...A, anio_desde: 2024 });
    expect(r.por_anio).toEqual([{ anio: 2024, registros: 230 }]);
    expect(r.por_evidencia.map((e) => e.tipo)).toEqual(['HUMAN_OBSERVATION', 'MACHINE_OBSERVATION']);
    expect((await series({ ...A, tipo_evidencia: 'MACHINE_OBSERVATION' })).por_evidencia).toEqual([{ tipo: 'MACHINE_OBSERVATION', registros: 50 }]);
    await rechaza(series({ ...A, familia: 'Tyrannidae' }));
    await rechaza(series({ ...A, con_foto: true }));
  });

  it('opciones: taxonomía desde el inventario, entidad/conjunto desde conteo_fuente, año/evidencia desde facetas', async () => {
    expect(pares(await op('familia', { clase: 'Aves', orden_taxon: 'Passeriformes' }, 'aves'))).toEqual([['Tyrannidae', 600], ['Thraupidae', 100]]);
    expect(pares(await op('orden', { familia: 'Tyrannidae' }, 'aves'))).toEqual([['Passeriformes', 700], ['Apodiformes', 80]]);
    expect((await op('entidad', {}, 'aves')).valores.map((v) => [v.nombre, v.registros])).toEqual([['Entidad Dos', 480], ['Entidad Uno', 300]]);
    expect(pares(await op('conjunto', { entidad_clave: E1 }, 'aves'))).toEqual([[DS1, 300]]);
    expect(pares(await op('anio', {}, 'aves'))).toEqual([['2020', 550], ['2024', 230]]);
    expect(pares(await op('tipo_evidencia', { departamento: 'Antioquia' }, 'aves'))).toEqual([['HUMAN_OBSERVATION', 200], ['MACHINE_OBSERVATION', 50]]);
  });

  it('opciones: combinaciones que no se pueden cruzar → 422', async () => {
    await rechaza(opciones({ ...A, campo: 'tipo_evidencia', limite: 10, familia: 'Tyrannidae' }));
    await rechaza(opciones({ ...A, campo: 'anio', limite: 10, tipo_evidencia: 'HUMAN_OBSERVATION' }));
    await rechaza(opciones({ ...A, campo: 'familia', limite: 10, anio_desde: 2000 }));
    await rechaza(opciones({ ...A, campo: 'entidad', limite: 10, familia: 'Tyrannidae' }));
    await rechaza(opciones({ ...A, campo: 'familia', limite: 10, con_foto: true }));
  });
});
