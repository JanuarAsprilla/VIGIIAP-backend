import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../src/utils/logger.js', () => ({
  default: { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() },
}));

import logger from '../src/utils/logger.js';
import { crearColaPorLotes } from '../src/utils/colaPorLotes.js';

function crear(extra = {}) {
  const vaciarLote = vi.fn().mockResolvedValue(undefined);
  const cola = crearColaPorLotes({
    nombre: 'prueba', vaciarLote, tope: 5, tamanoLote: 3, intervaloMs: 1000, ...extra,
  });
  return { cola, vaciarLote };
}

describe('colaPorLotes', () => {
  beforeEach(() => { vi.useFakeTimers(); vi.clearAllMocks(); });
  afterEach(() => { vi.useRealTimers(); });

  it('vacía por lotes al llegar al tamaño de lote, sin esperar al intervalo', async () => {
    const { cola, vaciarLote } = crear();
    cola.encolar(1); cola.encolar(2);
    expect(vaciarLote).not.toHaveBeenCalled();
    cola.encolar(3);
    await vi.advanceTimersByTimeAsync(0);
    expect(vaciarLote).toHaveBeenCalledWith([1, 2, 3]);
    await cola.cerrar();
  });

  it('vacía lo pendiente cuando vence el intervalo', async () => {
    const { cola, vaciarLote } = crear();
    cola.encolar('a');
    await vi.advanceTimersByTimeAsync(1000);
    expect(vaciarLote).toHaveBeenCalledWith(['a']);
    await cola.cerrar();
  });

  it('con el tope lleno descarta los más antiguos, los cuenta y lo registra sin lanzar', async () => {
    const { cola, vaciarLote } = crear({ tamanoLote: 100 });
    for (let i = 1; i <= 8; i += 1) expect(() => cola.encolar(i)).not.toThrow();
    expect(cola.estadisticas()).toMatchObject({ pendientes: 5, descartados: 3 });
    expect(logger.warn).toHaveBeenCalled();
    await cola.cerrar();
    expect(vaciarLote).toHaveBeenCalledWith([4, 5, 6, 7, 8]);
  });

  it('cerrar() vacía todo lo pendiente en varios lotes y deja de aceptar elementos', async () => {
    const { cola, vaciarLote } = crear({ tamanoLote: 2 });
    [1, 2, 3, 4, 5].forEach((n) => cola.encolar(n));
    await cola.cerrar();
    expect(vaciarLote.mock.calls.flat()).toEqual([[1, 2], [3, 4], [5]]);
    expect(cola.encolar(6)).toBe(false);
    expect(cola.estadisticas().pendientes).toBe(0);
  });

  it('un fallo al escribir el lote no lanza, se cuenta y la cola sigue funcionando', async () => {
    const vaciarLote = vi.fn().mockRejectedValueOnce(new Error('BD caída')).mockResolvedValue(undefined);
    const { cola } = crear({ vaciarLote });
    cola.encolar('x'); cola.encolar('y'); cola.encolar('z');
    await vi.advanceTimersByTimeAsync(0);
    expect(cola.estadisticas().perdidosPorError).toBe(3);
    expect(logger.error).toHaveBeenCalled();
    cola.encolar('w');
    await vi.advanceTimersByTimeAsync(1000);
    expect(vaciarLote).toHaveBeenLastCalledWith(['w']);
    await expect(cola.cerrar()).resolves.toBeUndefined();
  });

  it('cerrar() con la BD caída termina igual y no deja un bucle infinito', async () => {
    const vaciarLote = vi.fn().mockRejectedValue(new Error('BD caída'));
    const { cola } = crear({ vaciarLote, tamanoLote: 2 });
    [1, 2, 3, 4, 5].forEach((n) => cola.encolar(n));
    await expect(cola.cerrar()).resolves.toBeUndefined();
    expect(cola.estadisticas()).toMatchObject({ pendientes: 0, perdidosPorError: 5 });
  });

  it('no ejecuta dos vaciados a la vez', async () => {
    let activos = 0; let maximo = 0;
    const vaciarLote = vi.fn(async () => {
      activos += 1; maximo = Math.max(maximo, activos);
      await new Promise((r) => { setTimeout(r, 50); });
      activos -= 1;
    });
    const { cola } = crear({ vaciarLote, tamanoLote: 1 });
    cola.encolar(1); cola.encolar(2); cola.encolar(3);
    await vi.advanceTimersByTimeAsync(500);
    await cola.cerrar();
    expect(maximo).toBe(1);
    expect(vaciarLote.mock.calls.flat(2)).toEqual([1, 2, 3]);
  });
});
