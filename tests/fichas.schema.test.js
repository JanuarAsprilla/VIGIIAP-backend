import { describe, it, expect } from 'vitest';
import { importarFichasSchema, MAX_FILAS_IMPORTACION } from '../src/modules/fichas/fichas.schema.js';

describe('importarFichasSchema', () => {
  it('acepta filas válidas y por defecto no sobrescribe', () => {
    const r = importarFichasSchema.parse({ filas: [{ valor: 'EST-001', titulo: 'Quibdó', descripcion: 'Texto' }] });

    expect(r.sobrescribir).toBe(false);
    expect(r.filas[0]).toEqual({ valor: 'EST-001', titulo: 'Quibdó', descripcion: 'Texto' });
  });

  it('recorta los espacios del valor y del título', () => {
    const r = importarFichasSchema.parse({ filas: [{ valor: '  EST-001  ', titulo: '  Uno  ' }] });

    expect(r.filas[0].valor).toBe('EST-001');
    expect(r.filas[0].titulo).toBe('Uno');
  });

  it('la descripción es opcional y queda vacía', () => {
    expect(importarFichasSchema.parse({ filas: [{ valor: 'EST-001' }] }).filas[0].descripcion).toBe('');
  });

  it('rechaza una lista vacía', () => {
    expect(() => importarFichasSchema.parse({ filas: [] })).toThrow();
  });

  it('rechaza un valor vacío o solo espacios', () => {
    expect(() => importarFichasSchema.parse({ filas: [{ valor: '   ' }] })).toThrow();
  });

  it('rechaza más filas que el tope por petición', () => {
    const filas = Array.from({ length: MAX_FILAS_IMPORTACION + 1 }, (_, i) => ({ valor: `EST-${i}` }));

    expect(() => importarFichasSchema.parse({ filas })).toThrow();
  });

  it('rechaza una descripción de más de 10000 caracteres', () => {
    expect(() => importarFichasSchema.parse({ filas: [{ valor: 'EST-001', descripcion: 'a'.repeat(10001) }] })).toThrow();
  });
});
