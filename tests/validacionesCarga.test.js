import { describe, it, expect } from 'vitest';
import { municipioCuadra, verificarManifiesto } from '../scripts/biodiversidad/validaciones_carga.js';

const fila = (extra = {}) => ({
  registros: 100, sin_especie: 3, inventario: 97, inventario_sin_especie: 0, fuente: 100, ...extra,
});

describe('municipioCuadra', () => {
  it('inventario + sin especie = registros y fuentes = registros', () => {
    expect(municipioCuadra(fila())).toBe(true);
  });

  it('también vale si el inventario ya incluye los taxones sin especie', () => {
    expect(municipioCuadra(fila({ inventario: 100, inventario_sin_especie: 3 }))).toBe(true);
  });

  it('rechaza inventarios o fuentes que no suman', () => {
    expect(municipioCuadra(fila({ inventario: 90 }))).toBe(false);
    expect(municipioCuadra(fila({ inventario: 100, inventario_sin_especie: 1 }))).toBe(false);
    expect(municipioCuadra(fila({ fuente: 99 }))).toBe(false);
  });
});

describe('verificarManifiesto', () => {
  const permitidas = ['lote', 'registro', 'registro_detalle'];

  it('exige declarar cada tabla permitida, salvo el detalle de formatos anteriores', () => {
    expect(() => verificarManifiesto({ lote: 1, registro: 2 }, { lote: 1, registro: 2 }, permitidas)).not.toThrow();
    expect(() => verificarManifiesto({ lote: 1 }, { lote: 1 }, permitidas)).toThrow(/no declara la tabla registro/);
  });

  it('el detalle no declarado pero presente en el archivo se rechaza', () => {
    expect(() => verificarManifiesto({ lote: 1, registro: 2 }, { lote: 1, registro: 2, registro_detalle: 5 }, permitidas))
      .toThrow(/registro_detalle/);
  });

  it('un conteo que no coincide con lo leído se rechaza', () => {
    expect(() => verificarManifiesto({ lote: 1, registro: 3 }, { lote: 1, registro: 2 }, permitidas)).toThrow(/declara 3 filas de registro y se leyeron 2/);
  });
});
