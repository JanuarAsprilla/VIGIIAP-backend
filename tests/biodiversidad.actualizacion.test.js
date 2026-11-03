import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  cifrarClaveGbif, descifrarClaveGbif, cifradoDisponible,
} from '../src/utils/biodiversidadEncryption.js';
import { calcularFrescura } from '../src/modules/biodiversidad/actualizacion/actualizacion.service.js';

describe('cifrado de la clave de GBIF', () => {
  const original = process.env.BIODIVERSIDAD_ENCRYPTION_KEY;
  beforeEach(() => { process.env.BIODIVERSIDAD_ENCRYPTION_KEY = 'ab'.repeat(32); });
  afterEach(() => {
    if (original === undefined) delete process.env.BIODIVERSIDAD_ENCRYPTION_KEY; else process.env.BIODIVERSIDAD_ENCRYPTION_KEY = original;
  });

  it('cifra y descifra; el texto guardado no contiene la clave y cada cifrado es distinto', () => {
    const a = cifrarClaveGbif('mi-clave-secreta');
    const b = cifrarClaveGbif('mi-clave-secreta');
    expect(a).toMatch(/^[0-9a-f]+:[0-9a-f]+:[0-9a-f]+$/);
    expect(a).not.toContain('mi-clave-secreta');
    expect(a).not.toBe(b);
    expect(descifrarClaveGbif(a)).toBe('mi-clave-secreta');
  });

  it('detecta manipulación del texto cifrado', () => {
    const [iv, tag, enc] = cifrarClaveGbif('x'.repeat(20)).split(':');
    const roto = `${iv}:${tag}:${enc.slice(0, -2)}${enc.endsWith('00') ? '11' : '00'}`;
    expect(() => descifrarClaveGbif(roto)).toThrow();
  });

  it('no descifra con otra clave', () => {
    const cifrado = cifrarClaveGbif('secreto');
    process.env.BIODIVERSIDAD_ENCRYPTION_KEY = 'cd'.repeat(32);
    expect(() => descifrarClaveGbif(cifrado)).toThrow();
  });

  it.each(['', 'corta', 'zz'.repeat(32)])('sin clave utilizable (%j): no cifra, responde 503 y cifradoDisponible es false', (valor) => {
    process.env.BIODIVERSIDAD_ENCRYPTION_KEY = valor;
    expect(cifradoDisponible()).toBe(false);
    expect(() => cifrarClaveGbif('x')).toThrow(expect.objectContaining({ status: 503, codigo: 'cifrado_no_configurado' }));
  });

  it('rechaza formatos que no son iv:tag:enc', () => {
    expect(() => descifrarClaveGbif('texto plano')).toThrow('Credencial con formato inválido');
    expect(() => descifrarClaveGbif(null)).toThrow('Credencial con formato inválido');
  });
});

describe('calcularFrescura()', () => {
  it('sin línea base, la primera medición lo es y el crecimiento es 0', () => {
    expect(calcularFrescura({ aves: 1000, hongos: 50 }, null)).toEqual({
      linea_base: true,
      grupos: { aves: { gbif: 1000, base: 1000, crecimiento_pct: 0 }, hongos: { gbif: 50, base: 50, crecimiento_pct: 0 } },
    });
  });

  it('con línea base calcula el porcentaje de crecimiento con un decimal', () => {
    const r = calcularFrescura({ aves: 1070, hongos: 50 }, { aves: 1000, hongos: 50 });
    expect(r.linea_base).toBe(false);
    expect(r.grupos.aves).toEqual({ gbif: 1070, base: 1000, crecimiento_pct: 7 });
    expect(r.grupos.hongos.crecimiento_pct).toBe(0);
    expect(calcularFrescura({ x: 1234 }, { x: 1000 }).grupos.x.crecimiento_pct).toBe(23.4);
  });

  it('un grupo nuevo sin base no inventa crecimiento; la base cero no divide', () => {
    const r = calcularFrescura({ aves: 10, nuevo: 5 }, { aves: 0 });
    expect(r.grupos.aves.crecimiento_pct).toBe(0);
    expect(r.grupos.nuevo).toEqual({ gbif: 5, base: 5, crecimiento_pct: 0 });
  });

  it('ignora valores que no son enteros no negativos (nada de NaN ni textos)', () => {
    const r = calcularFrescura({ aves: 'mil', hongos: -1, reptiles: 1.5, ok: 7 }, null);
    expect(Object.keys(r.grupos)).toEqual(['ok']);
  });
});
