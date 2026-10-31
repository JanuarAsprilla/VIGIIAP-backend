import { describe, it, expect, vi } from 'vitest';
import { memoizar } from '../src/utils/cacheLocal.js';

function relojManual(inicio = 1_000) {
  let ahora = inicio;
  return { ahora: () => ahora, avanzar: (ms) => { ahora += ms; } };
}

describe('memoizar()', () => {
  it('reutiliza el resultado mientras no venza el TTL', async () => {
    const reloj = relojManual();
    const calcular = vi.fn().mockResolvedValue({ total: 5 });
    const leer = memoizar(calcular, 30_000, { ahora: reloj.ahora });

    await leer();
    reloj.avanzar(29_999);
    await leer();

    expect(calcular).toHaveBeenCalledTimes(1);
  });

  it('vuelve a calcular cuando vence el TTL', async () => {
    const reloj = relojManual();
    const calcular = vi.fn().mockResolvedValueOnce(1).mockResolvedValueOnce(2);
    const leer = memoizar(calcular, 30_000, { ahora: reloj.ahora });

    expect(await leer()).toBe(1);
    reloj.avanzar(30_000);
    expect(await leer()).toBe(2);
  });

  it('las llamadas simultáneas comparten una sola ejecución (single-flight)', async () => {
    let liberar;
    const calcular = vi.fn(() => new Promise((resolver) => { liberar = () => resolver('listo'); }));
    const leer = memoizar(calcular, 30_000);

    const llamadas = [leer(), leer(), leer()];
    liberar();

    expect(await Promise.all(llamadas)).toEqual(['listo', 'listo', 'listo']);
    expect(calcular).toHaveBeenCalledTimes(1);
  });

  it('no guarda los errores: la siguiente llamada reintenta', async () => {
    const calcular = vi.fn().mockRejectedValueOnce(new Error('base caída')).mockResolvedValueOnce('ok');
    const leer = memoizar(calcular, 30_000);

    await expect(leer()).rejects.toThrow('base caída');
    expect(await leer()).toBe('ok');
  });

  it('argumentos distintos tienen entradas distintas', async () => {
    const calcular = vi.fn(async (rango) => rango.desde);
    const leer = memoizar(calcular, 30_000);

    expect(await leer({ desde: 'a' })).toBe('a');
    expect(await leer({ desde: 'b' })).toBe('b');
    expect(await leer({ desde: 'a' })).toBe('a');
    expect(calcular).toHaveBeenCalledTimes(2);
  });

  it('con TTL 0 no guarda nada y siempre consulta', async () => {
    const calcular = vi.fn().mockResolvedValue('x');
    const leer = memoizar(calcular, 0);

    await leer();
    await leer();

    expect(calcular).toHaveBeenCalledTimes(2);
  });

  it('acota el tamaño: descarta la entrada más antigua al superar el máximo', async () => {
    const calcular = vi.fn(async (n) => n);
    const leer = memoizar(calcular, 30_000, { maxEntradas: 2 });

    await leer(1);
    await leer(2);
    await leer(3);
    await leer(1);

    expect(calcular).toHaveBeenCalledTimes(4);
  });
});
