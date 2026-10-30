import { describe, it, expect } from 'vitest';
import {
  municipiosQuerySchema, registrosQuerySchema, GRUPOS, TAMANO_MAXIMO, PROFUNDIDAD_MAXIMA,
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
