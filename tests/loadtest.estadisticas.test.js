import { describe, it, expect } from 'vitest';
import { percentil, resumir, evaluarUmbrales, elegirRuta } from '../loadtest/estadisticas.mjs';

describe('percentil()', () => {
  it('devuelve 0 si no hay muestras', () => {
    expect(percentil([], 95)).toBe(0);
  });

  it('usa el método del rango más cercano', () => {
    const muestras = Array.from({ length: 100 }, (_, i) => i + 1);
    expect(percentil(muestras, 50)).toBe(50);
    expect(percentil(muestras, 95)).toBe(95);
    expect(percentil(muestras, 99)).toBe(99);
    expect(percentil(muestras, 100)).toBe(100);
  });

  it('no depende del orden de entrada ni modifica el arreglo recibido', () => {
    const muestras = [30, 10, 20];
    expect(percentil(muestras, 50)).toBe(20);
    expect(muestras).toEqual([30, 10, 20]);
  });
});

describe('resumir()', () => {
  it('calcula totales, errores, rps y percentiles', () => {
    const resultado = resumir({
      latencias: [10, 20, 30, 40],
      estados: [200, 200, 429, 500],
      duracionSeg: 2,
    });
    expect(resultado).toMatchObject({ total: 4, rps: 2, p50: 20, max: 40, limitadas: 1, errores: 1 });
    expect(resultado.tasaError).toBeCloseTo(0.25);
  });

  it('soporta cientos de miles de muestras sin desbordar la pila', () => {
    const latencias = Array.from({ length: 300_000 }, (_, i) => i % 1000);
    const estados = latencias.map(() => 200);
    expect(resumir({ latencias, estados, duracionSeg: 10 }).max).toBe(999);
  });

  it('con cero peticiones no divide entre cero', () => {
    expect(resumir({ latencias: [], estados: [], duracionSeg: 5 })).toMatchObject({ total: 0, rps: 0, tasaError: 0 });
  });
});

describe('evaluarUmbrales()', () => {
  const resumen = { p95: 300, tasaError: 0.002 };

  it('aprueba si p95 y tasa de error están dentro del umbral', () => {
    expect(evaluarUmbrales(resumen, { p95Ms: 500, tasaErrorMax: 0.01 })).toEqual({ aprobado: true, fallos: [] });
  });

  it('reporta cada umbral incumplido', () => {
    const { aprobado, fallos } = evaluarUmbrales(resumen, { p95Ms: 200, tasaErrorMax: 0.001 });
    expect(aprobado).toBe(false);
    expect(fallos).toHaveLength(2);
  });
});

describe('elegirRuta()', () => {
  const rutas = [{ ruta: '/a', peso: 3 }, { ruta: '/b', peso: 1 }];

  it('elige según el peso acumulado', () => {
    expect(elegirRuta(rutas, 0).ruta).toBe('/a');
    expect(elegirRuta(rutas, 0.74).ruta).toBe('/a');
    expect(elegirRuta(rutas, 0.75).ruta).toBe('/b');
    expect(elegirRuta(rutas, 0.999).ruta).toBe('/b');
  });
});
