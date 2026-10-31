import { describe, it, expect } from 'vitest';
import {
  municipiosQuerySchema, resumenQuerySchema, seriesQuerySchema, especiesQuerySchema, registrosQuerySchema,
  puntosQuerySchema, opcionesQuerySchema,
} from '../src/modules/biodiversidad/biodiversidad.schema.js';

const UUID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const TODAS = [municipiosQuerySchema, resumenQuerySchema, seriesQuerySchema, especiesQuerySchema, registrosQuerySchema, puntosQuerySchema];
const conCampo = (q) => ({ campo: 'clase', ...q });

describe('filtros comunes', () => {
  it.each(TODAS.map((s, i) => [i, s]))('la ruta %i acepta el juego completo de filtros', (_i, esquema) => {
    const r = esquema.parse({
      grupo: 'anfibios', codigo_municipal: '27001', departamento: 'Chocó',
      reino: 'Animalia', division: 'Chordata', clase: 'Amphibia', orden_taxon: 'Anura', familia: 'Bufonidae', genero: 'Rhinella',
      especie_clave: '123', buscar: 'rhi', conservacion: 'amenazada', amenaza: 'CR', entidad_clave: UUID, dataset_key: UUID,
      anio_desde: '2000', anio_hasta: '2020', tipo_evidencia: 'HUMAN_OBSERVATION', con_foto: 'true', con_ubicacion: 'true',
    });
    expect(r).toMatchObject({ familia: 'Bufonidae', anio_desde: 2000, con_foto: true, con_ubicacion: true, entidad_clave: UUID });
  });

  it('opciones acepta los mismos filtros más campo', () => {
    expect(opcionesQuerySchema.parse(conCampo({ grupo: 'aves', orden: 'Anura', familia: 'Bufonidae' }))).toMatchObject({ campo: 'clase', limite: 100, orden_taxon: 'Anura' });
  });

  it('taxonomía: solo letras, espacios y .-\'() de 2 a 80 caracteres', () => {
    for (const malo of ['A', 'x'.repeat(81), "Anura'; DROP TABLE x;--", 'Ba%', 'a_b', 'Ba\\', '<b>', 'Anura=1', '1234']) {
      expect(() => registrosQuerySchema.parse({ grupo: 'aves', familia: malo }), malo).toThrow();
    }
    expect(registrosQuerySchema.parse({ grupo: 'aves', genero: "Cf. d'Orb. (sp-a)" }).genero).toBe("Cf. d'Orb. (sp-a)");
  });

  it('valida valores enumerados y formatos', () => {
    const malos = [{ conservacion: 'x' }, { amenaza: 'LC' }, { entidad_clave: 'no-uuid' }, { dataset_key: `${UUID}x` },
      { anio_desde: '1899' }, { anio_hasta: '2101' }, { tipo_evidencia: 'human' }, { tipo_evidencia: 'A;B' }, { con_foto: 'false' },
      { con_ubicacion: '1' }, { especie_clave: 'a b' }];
    for (const m of malos) expect(() => puntosQuerySchema.parse({ grupo: 'anfibios', ...m }), JSON.stringify(m)).toThrow();
  });

  it('rechaza parámetros desconocidos y repetidos', () => {
    expect(() => especiesQuerySchema.parse({ grupo: 'aves', sql: '1' })).toThrow();
    expect(() => municipiosQuerySchema.parse({ grupo: 'aves', clase: ['a', 'b'] })).toThrow();
    expect(() => resumenQuerySchema.parse({ grupo: 'aves', familia: ['Aa', 'Bb'] })).toThrow();
  });

  it('rango de años invertido en cualquier ruta', () => {
    for (const s of TODAS) expect(() => s.parse({ grupo: 'aves', anio_desde: '2020', anio_hasta: '2010' })).toThrow(/anio_desde/);
  });

  it('entidad y conjunto en minúsculas normalizadas', () => {
    expect(resumenQuerySchema.parse({ grupo: 'aves', dataset_key: UUID.toUpperCase() }).dataset_key).toBe(UUID);
  });
});

describe('orden taxonómico vs ordenamiento', () => {
  it('en rutas sin ordenamiento, orden es sinónimo de orden_taxon; ambos a la vez se rechazan', () => {
    for (const s of [municipiosQuerySchema, resumenQuerySchema, seriesQuerySchema, puntosQuerySchema]) {
      const r = s.parse({ grupo: 'aves', orden: 'Anura' });
      expect(r).toMatchObject({ orden_taxon: 'Anura' });
      expect(r.orden).toBeUndefined();
      expect(() => s.parse({ grupo: 'aves', orden: 'Anura', orden_taxon: 'Anura' })).toThrow(/ambos/);
    }
  });

  it('en /especies y /registros orden es el ordenamiento y el taxón va en orden_taxon', () => {
    expect(registrosQuerySchema.parse({ grupo: 'aves', orden: 'especie', orden_taxon: 'Anura' })).toMatchObject({ orden: 'especie', orden_taxon: 'Anura' });
    expect(() => registrosQuerySchema.parse({ grupo: 'aves', orden: 'Anura' })).toThrow();
    expect(() => especiesQuerySchema.parse({ grupo: 'aves', orden: 'Anura' })).toThrow();
  });
});

describe('orden de /registros y /especies', () => {
  it('registros: anio_desc por defecto, anio_asc y especie; otros rechazados', () => {
    expect(registrosQuerySchema.parse({ grupo: 'anfibios' }).orden).toBe('anio_desc');
    for (const o of ['anio_asc', 'especie']) expect(registrosQuerySchema.parse({ grupo: 'anfibios', orden: o }).orden).toBe(o);
    expect(() => registrosQuerySchema.parse({ grupo: 'anfibios', orden: 'gbif_id; DROP' })).toThrow();
  });

  it('especies: registros por defecto, nombre y municipios', () => {
    expect(especiesQuerySchema.parse({ grupo: 'anfibios' }).orden).toBe('registros');
    expect(especiesQuerySchema.parse({ grupo: 'anfibios', orden: 'municipios' }).orden).toBe('municipios');
    expect(() => especiesQuerySchema.parse({ grupo: 'anfibios', orden: 'x' })).toThrow();
  });
});

describe('puntosQuerySchema', () => {
  it('bbox válido se convierte a cuatro números y limite tiene defecto 1500', () => {
    const r = puntosQuerySchema.parse({ grupo: 'anfibios', bbox: '-77.5,5.0,-76.0,6.5' });
    expect(r.bbox).toEqual([-77.5, 5, -76, 6.5]);
    expect(r.limite).toBe(1500);
    expect(puntosQuerySchema.parse({ grupo: 'anfibios' }).bbox).toBeUndefined();
  });

  it.each(['1,2,3', '1,2,3,4,5', 'a,b,c,d', '-77,5,-78,6', '-77,6,-76,5', '-181,0,0,1', '0,-91,1,0', '0,0,181,1', '0,0,1,91',
    "1,2,3,4'; DROP TABLE x", '', '1,2,3,', '1e400,2,3,4', 'NaN,1,2,3'])('rechaza bbox %j', (bbox) => {
    expect(() => puntosQuerySchema.parse({ grupo: 'anfibios', bbox })).toThrow();
  });

  it('limite entre 1 y 2000', () => {
    expect(puntosQuerySchema.parse({ grupo: 'anfibios', limite: '2000' }).limite).toBe(2000);
    for (const l of ['0', '2001', 'x']) expect(() => puntosQuerySchema.parse({ grupo: 'anfibios', limite: l })).toThrow();
  });
});

describe('opcionesQuerySchema', () => {
  it('exige campo válido', () => {
    expect(() => opcionesQuerySchema.parse({ grupo: 'aves' })).toThrow();
    expect(() => opcionesQuerySchema.parse({ grupo: 'aves', campo: 'especie' })).toThrow();
    for (const c of ['reino', 'division', 'clase', 'orden', 'familia', 'genero', 'entidad', 'conjunto', 'tipo_evidencia', 'anio']) {
      expect(opcionesQuerySchema.parse({ grupo: 'aves', campo: c }).campo).toBe(c);
    }
  });

  it('limite 1–200 (defecto 100) y buscar solo texto seguro', () => {
    expect(opcionesQuerySchema.parse(conCampo({ grupo: 'aves', limite: '200' })).limite).toBe(200);
    for (const l of ['0', '201']) expect(() => opcionesQuerySchema.parse(conCampo({ grupo: 'aves', limite: l }))).toThrow();
    expect(opcionesQuerySchema.parse(conCampo({ grupo: 'aves', buscar: 'bufo' })).buscar).toBe('bufo');
    for (const b of ['%%', 'a_b', "a'; DROP", 'x\\', 'a']) expect(() => opcionesQuerySchema.parse(conCampo({ grupo: 'aves', buscar: b }))).toThrow();
  });
});
