import { describe, it, expect } from 'vitest';
import {
  municipiosQuerySchema, registrosQuerySchema, resumenQuerySchema, especiesQuerySchema, seriesQuerySchema,
  detalleQuerySchema, registroParamsSchema, GRUPOS, TAMANO_MAXIMO, PROFUNDIDAD_MAXIMA,
} from '../src/modules/biodiversidad/biodiversidad.schema.js';

describe('registrosQuerySchema', () => {
  it('aplica valores por defecto y convierte números de la query string', () => {
    expect(registrosQuerySchema.parse({ grupo: 'anfibios' })).toEqual({ grupo: 'anfibios', pagina: 1, tamano: 25 });
    expect(registrosQuerySchema.parse({ grupo: 'hongos', pagina: '2', tamano: '10', anio_desde: '2000' }))
      .toMatchObject({ pagina: 2, tamano: 10, anio_desde: 2000 });
  });

  it('acepta todos los grupos conocidos y rechaza los demás', () => {
    for (const grupo of GRUPOS) expect(registrosQuerySchema.parse({ grupo }).grupo).toBe(grupo);
    expect(() => registrosQuerySchema.parse({ grupo: 'dinosaurios' })).toThrow();
    expect(() => registrosQuerySchema.parse({})).toThrow();
  });

  it('rechaza parámetros que no están declarados', () => {
    expect(() => registrosQuerySchema.parse({ grupo: 'aves', orden: 'gbif_id; DROP TABLE x' })).toThrow();
  });

  it('rechaza parámetros repetidos (arreglos en la query string)', () => {
    expect(() => registrosQuerySchema.parse({ grupo: ['aves', 'hongos'] })).toThrow();
    expect(() => registrosQuerySchema.parse({ grupo: 'aves', departamento: ['a', 'b'] })).toThrow();
  });

  it('rechaza un tamaño de página mayor al máximo', () => {
    expect(registrosQuerySchema.parse({ grupo: 'aves', tamano: String(TAMANO_MAXIMO) }).tamano).toBe(TAMANO_MAXIMO);
    expect(() => registrosQuerySchema.parse({ grupo: 'aves', tamano: String(TAMANO_MAXIMO + 1) })).toThrow();
    expect(() => registrosQuerySchema.parse({ grupo: 'aves', tamano: '0' })).toThrow();
  });

  it('limita la profundidad de paginación para evitar barridos completos', () => {
    const ultimaPagina = PROFUNDIDAD_MAXIMA / 100;
    expect(registrosQuerySchema.parse({ grupo: 'aves', tamano: '100', pagina: String(ultimaPagina) }).pagina).toBe(ultimaPagina);
    expect(() => registrosQuerySchema.parse({ grupo: 'aves', tamano: '100', pagina: String(ultimaPagina + 1) })).toThrow(/filtros/);
  });

  it('rechaza un rango de años invertido', () => {
    expect(() => registrosQuerySchema.parse({ grupo: 'aves', anio_desde: '2020', anio_hasta: '2010' })).toThrow(/anio_desde/);
    expect(registrosQuerySchema.parse({ grupo: 'aves', anio_desde: '2010', anio_hasta: '2010' })).toMatchObject({ anio_desde: 2010 });
  });

  it('rechaza códigos de municipio con caracteres peligrosos', () => {
    expect(() => registrosQuerySchema.parse({ grupo: 'aves', codigo_municipal: "27001'; DROP TABLE x;--" })).toThrow();
    expect(registrosQuerySchema.parse({ grupo: 'aves', codigo_municipal: '27001' }).codigo_municipal).toBe('27001');
  });

  it('limita la longitud del departamento', () => {
    expect(() => registrosQuerySchema.parse({ grupo: 'aves', departamento: 'x'.repeat(61) })).toThrow();
  });
});

describe('municipiosQuerySchema', () => {
  it('exige grupo y no admite otros parámetros', () => {
    expect(municipiosQuerySchema.parse({ grupo: 'plantas' })).toEqual({ grupo: 'plantas' });
    expect(() => municipiosQuerySchema.parse({})).toThrow();
    expect(() => municipiosQuerySchema.parse({ grupo: 'plantas', extra: '1' })).toThrow();
  });
});

describe('registrosQuerySchema — filtros nuevos', () => {
  it('acepta buscar, con_foto, conservacion, amenaza y especie_clave', () => {
    expect(registrosQuerySchema.parse({
      grupo: 'anfibios', buscar: '  rana  ', con_foto: 'true', conservacion: 'amenazada', amenaza: 'CR', especie_clave: '2431',
    })).toMatchObject({ buscar: 'rana', con_foto: true, conservacion: 'amenazada', amenaza: 'CR', especie_clave: '2431' });
  });

  it('con_foto solo admite true', () => {
    expect(() => registrosQuerySchema.parse({ grupo: 'anfibios', con_foto: 'false' })).toThrow();
    expect(() => registrosQuerySchema.parse({ grupo: 'anfibios', con_foto: '1' })).toThrow();
  });

  it('valida enumerados y formatos', () => {
    expect(() => registrosQuerySchema.parse({ grupo: 'anfibios', conservacion: 'rara' })).toThrow();
    expect(() => registrosQuerySchema.parse({ grupo: 'anfibios', amenaza: 'LC' })).toThrow();
    expect(() => registrosQuerySchema.parse({ grupo: 'anfibios', especie_clave: "1'; DROP TABLE x;--" })).toThrow();
    expect(() => registrosQuerySchema.parse({ grupo: 'anfibios', especie_clave: 'a'.repeat(21) })).toThrow();
  });

  it('buscar exige entre 2 y 60 caracteres y rechaza repetidos', () => {
    expect(() => registrosQuerySchema.parse({ grupo: 'anfibios', buscar: 'a' })).toThrow();
    expect(() => registrosQuerySchema.parse({ grupo: 'anfibios', buscar: ' a ' })).toThrow();
    expect(() => registrosQuerySchema.parse({ grupo: 'anfibios', buscar: 'x'.repeat(61) })).toThrow();
    expect(() => registrosQuerySchema.parse({ grupo: 'anfibios', buscar: ['ra', 'na'] })).toThrow();
  });
});

describe('resumenQuerySchema y seriesQuerySchema', () => {
  it.each([resumenQuerySchema, seriesQuerySchema])('exigen grupo y solo admiten alcance territorial', (esquema) => {
    expect(esquema.parse({ grupo: 'aves', departamento: 'Chocó', codigo_municipal: '27001' }))
      .toEqual({ grupo: 'aves', departamento: 'Chocó', codigo_municipal: '27001' });
    expect(() => esquema.parse({})).toThrow();
    expect(() => esquema.parse({ grupo: 'aves', pagina: '1' })).toThrow();
    expect(() => esquema.parse({ grupo: 'aves', codigo_municipal: "27001' OR 1=1" })).toThrow();
    expect(() => esquema.parse({ grupo: ['aves', 'hongos'] })).toThrow();
  });
});

describe('especiesQuerySchema', () => {
  it('acepta con_foto=true como booleano', () => {
    expect(especiesQuerySchema.parse({ grupo: 'anfibios', con_foto: 'true' })).toMatchObject({ con_foto: true });
  });

  it('con_foto solo admite true', () => {
    expect(() => especiesQuerySchema.parse({ grupo: 'anfibios', con_foto: 'false' })).toThrow();
    expect(() => especiesQuerySchema.parse({ grupo: 'anfibios', con_foto: '1' })).toThrow();
    expect(() => especiesQuerySchema.parse({ grupo: 'anfibios', con_foto: ['true', 'true'] })).toThrow();
  });

  it('aplica defecto de orden y paginación', () => {
    expect(especiesQuerySchema.parse({ grupo: 'aves' })).toEqual({ grupo: 'aves', orden: 'registros', pagina: 1, tamano: 25 });
  });

  it('acepta los filtros de la especie y el orden por nombre', () => {
    expect(especiesQuerySchema.parse({ grupo: 'aves', buscar: 'tangara', conservacion: 'endemica', amenaza: 'VU', orden: 'nombre', departamento: 'Chocó' }))
      .toMatchObject({ buscar: 'tangara', conservacion: 'endemica', amenaza: 'VU', orden: 'nombre', departamento: 'Chocó' });
  });

  it('rechaza orden desconocido, parámetros no declarados y filtros de registro (anio_desde)', () => {
    expect(() => especiesQuerySchema.parse({ grupo: 'aves', orden: 'gbif_id' })).toThrow();
    expect(() => especiesQuerySchema.parse({ grupo: 'aves', orden: 'registros; DROP TABLE x' })).toThrow();
    expect(() => especiesQuerySchema.parse({ grupo: 'aves', anio_desde: '2000' })).toThrow();
  });

  it('limita la profundidad de paginación', () => {
    expect(() => especiesQuerySchema.parse({ grupo: 'aves', tamano: '100', pagina: '101' })).toThrow(/filtros/);
    expect(() => especiesQuerySchema.parse({ grupo: 'aves', tamano: '101' })).toThrow();
  });
});

describe('detalle de un registro', () => {
  it('gbif_id solo admite dígitos (1 a 20)', () => {
    expect(registroParamsSchema.parse({ gbif_id: '5036794008' })).toEqual({ gbif_id: '5036794008' });
    for (const malo of ['', 'abc', '12 34', "1' OR '1'='1", '1'.repeat(21), '-5', '1.5']) {
      expect(() => registroParamsSchema.parse({ gbif_id: malo })).toThrow();
    }
  });

  it('la consulta exige grupo y no admite más parámetros', () => {
    expect(detalleQuerySchema.parse({ grupo: 'hongos' })).toEqual({ grupo: 'hongos' });
    expect(() => detalleQuerySchema.parse({})).toThrow();
    expect(() => detalleQuerySchema.parse({ grupo: 'hongos', pagina: '1' })).toThrow();
  });
});
