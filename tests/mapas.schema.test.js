/**
 * Tests para los metadatos técnicos opcionales de mapas (ISO 19115 / IGAC)
 * y en particular el helper clearable(): sin él, mandar '' para borrar un
 * campo numérico opcional revienta la validación en vez de limpiarlo
 * (Number('') = 0, no positive; '' no cumple min(3) en fuente).
 */
import { describe, it, expect } from 'vitest';
import { createMapaSchema, updateMapaSchema } from '../src/modules/mapas/mapas.schema.js';

const BASE = { titulo: 'Mapa de prueba', categoria: 'Hidrología' };

describe('mapas.schema — metadatos técnicos', () => {
  it('acepta la creación sin ningún metadato técnico', () => {
    const result = createMapaSchema.parse(BASE);
    expect(result.epsg).toBeUndefined();
    expect(result.escala).toBeUndefined();
    expect(result.fuente).toBeUndefined();
  });

  it('valida y coerciona los metadatos cuando se envían como strings (multipart)', () => {
    const result = createMapaSchema.parse({
      ...BASE,
      epsg: '4326', escala: '100000', fuente: 'Imágenes Sentinel-2',
      bbox_norte: '5.5', bbox_sur: '4.0', bbox_este: '-76.0', bbox_oeste: '-77.5',
    });
    expect(result.epsg).toBe(4326);
    expect(result.escala).toBe(100000);
    expect(result.fuente).toBe('Imágenes Sentinel-2');
    expect(result.bbox_norte).toBe(5.5);
  });

  it('rechaza un epsg no positivo', () => {
    expect(() => createMapaSchema.parse({ ...BASE, epsg: '-1' })).toThrow();
  });

  it('rechaza bbox_norte <= bbox_sur', () => {
    expect(() => createMapaSchema.parse({ ...BASE, bbox_norte: '4.0', bbox_sur: '5.5' })).toThrow();
  });

  it('rechaza bbox_este <= bbox_oeste', () => {
    expect(() => createMapaSchema.parse({ ...BASE, bbox_este: '-77.5', bbox_oeste: '-76.0' })).toThrow();
  });

  // Regresión: '' es como llega un input vacío desde FormData -- antes de
  // clearable(), esto reventaba en vez de limpiar el campo.
  it('un string vacío limpia un metadato numérico a null, sin lanzar', () => {
    const result = updateMapaSchema.parse({ epsg: '', escala: '', bbox_norte: '' });
    expect(result.epsg).toBeNull();
    expect(result.escala).toBeNull();
    expect(result.bbox_norte).toBeNull();
  });

  it('un string vacío limpia "fuente" (string con min length) a null, sin lanzar', () => {
    const result = updateMapaSchema.parse({ fuente: '' });
    expect(result.fuente).toBeNull();
  });

  it('omitir un campo en el update lo deja como undefined (no se toca la columna)', () => {
    const result = updateMapaSchema.parse({ titulo: 'Nuevo título' });
    expect(result.epsg).toBeUndefined();
  });
});
