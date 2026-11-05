import { describe, it, expect } from 'vitest';
import { esGeometriaValida, MAX_VERTICES_GEOMETRIA } from '../src/utils/geometry.js';

const cuadrado = [[-76.9, 5.6], [-76.8, 5.6], [-76.8, 5.7], [-76.9, 5.7], [-76.9, 5.6]];

/** Anillo cerrado con `n` vértices en total (incluido el de cierre). */
function anilloConVertices(n) {
  const puntos = Array.from({ length: n - 1 }, (_, i) => [-76.9 + i * 1e-6, 5.6 + (i % 2) * 1e-6]);
  return [...puntos, puntos[0]];
}

describe('esGeometriaValida', () => {
  it('acepta un polígono y un multipolígono bien formados', () => {
    expect(esGeometriaValida({ type: 'Polygon', coordinates: [cuadrado] })).toBe(true);
    expect(esGeometriaValida({ type: 'MultiPolygon', coordinates: [[cuadrado], [cuadrado]] })).toBe(true);
  });

  it.each([null, 'texto', {}, { type: 'Point', coordinates: [0, 0] }, { type: 'Polygon', coordinates: [[[0, 0]]] }])(
    'rechaza %j',
    (geometria) => {
      expect(esGeometriaValida(geometria)).toBe(false);
    },
  );

  it('rechaza coordenadas fuera de rango o un anillo sin cerrar', () => {
    expect(esGeometriaValida({ type: 'Polygon', coordinates: [[[0, 0], [200, 0], [200, 5], [0, 0]]] })).toBe(false);
    expect(esGeometriaValida({ type: 'Polygon', coordinates: [[[0, 0], [1, 0], [1, 1], [0, 1]]] })).toBe(false);
  });

  it('acepta un polígono en el tope de vértices y rechaza uno que lo supera', () => {
    expect(esGeometriaValida({ type: 'Polygon', coordinates: [anilloConVertices(MAX_VERTICES_GEOMETRIA)] })).toBe(true);
    expect(esGeometriaValida({ type: 'Polygon', coordinates: [anilloConVertices(MAX_VERTICES_GEOMETRIA + 1)] })).toBe(false);
  });

  it('el tope de vértices cuenta el total del multipolígono, no cada polígono', () => {
    const mitad = anilloConVertices(MAX_VERTICES_GEOMETRIA / 2 + 1);
    expect(esGeometriaValida({ type: 'MultiPolygon', coordinates: [[mitad], [mitad]] })).toBe(false);
  });
});
