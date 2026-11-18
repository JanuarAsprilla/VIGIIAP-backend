import { describe, it, expect, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { limiteSimultaneasPorIp, leerTope } from '../src/middlewares/limiteSimultaneas.js';

function respuesta() {
  const res = new EventEmitter();
  res.headers = {};
  res.set = vi.fn((k, v) => { res.headers[k] = v; return res; });
  res.status = vi.fn((c) => { res.statusCode = c; return res; });
  res.json = vi.fn((b) => { res.body = b; return res; });
  return res;
}
const entrar = (mw, ip = '1.1.1.1') => {
  const res = respuesta();
  const next = vi.fn();
  mw({ ip }, res, next);
  return { res, next };
};

describe('limiteSimultaneasPorIp', () => {
  it('deja pasar hasta el tope y responde 503 con Retry-After al siguiente', () => {
    const mw = limiteSimultaneasPorIp({ tope: 2, mensaje: 'ocupado' });
    entrar(mw); entrar(mw);
    const { res, next } = entrar(mw);
    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(503);
    expect(res.headers['Retry-After']).toBe('3');
    expect(res.body).toEqual({ error: 'ocupado' });
  });

  it('libera el cupo al terminar la respuesta, y una sola vez', () => {
    const mw = limiteSimultaneasPorIp({ tope: 1, mensaje: 'x' });
    const a = entrar(mw);
    a.res.emit('finish');
    a.res.emit('close');
    expect(entrar(mw).next).toHaveBeenCalled();
    expect(entrar(mw).res.statusCode).toBe(503);
  });

  it.each(['close', 'error'])('si el cliente se va («%s»), el cupo sigue ocupado hasta que pase la gracia de la consulta', (evento) => {
    vi.useFakeTimers();
    try {
      const mw = limiteSimultaneasPorIp({ tope: 1, mensaje: 'x', graciaMs: 6000 });
      const a = entrar(mw);
      a.res.emit(evento);
      expect(entrar(mw).res.statusCode).toBe(503);
      vi.advanceTimersByTime(5999);
      expect(entrar(mw).res.statusCode).toBe(503);
      vi.advanceTimersByTime(1);
      expect(entrar(mw).next).toHaveBeenCalled();
      expect(mw.enCurso()).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('cuenta cada IP por separado y no retiene memoria al quedar en cero', () => {
    const mw = limiteSimultaneasPorIp({ tope: 1, mensaje: 'x' });
    const a = entrar(mw, '1.1.1.1');
    expect(entrar(mw, '2.2.2.2').next).toHaveBeenCalled();
    expect(mw.enCurso()).toBe(2);
    a.res.emit('finish');
    expect(mw.enCurso()).toBe(1);
  });

  it('el tope por defecto es 4 y una variable inválida cae al valor seguro', () => {
    expect(leerTope(undefined)).toBe(4);
    expect(leerTope('0')).toBe(4);
    expect(leerTope('abc')).toBe(4);
    expect(leerTope('1e3')).toBe(4);
    expect(leerTope('6')).toBe(6);
    const mw = limiteSimultaneasPorIp({ mensaje: 'x' });
    for (let i = 0; i < 4; i += 1) expect(entrar(mw).next).toHaveBeenCalled();
    expect(entrar(mw).res.statusCode).toBe(503);
  });
});
