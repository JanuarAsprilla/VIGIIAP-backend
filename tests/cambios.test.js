import { describe, it, expect } from 'vitest';
import { diffCambios } from '../src/utils/cambios.js';

describe('diffCambios()', () => {
  it('devuelve solo los campos que cambiaron', () => {
    const r = diffCambios({ rol: 'tecnico', activo: true }, { rol: 'investigador', activo: true });
    expect(r).toEqual({ rol: { antes: 'tecnico', despues: 'investigador' } });
  });

  it('devuelve null cuando nada cambió', () => {
    expect(diffCambios({ a: 1 }, { a: 1 })).toBeNull();
  });

  it('oculta los campos que parecen secretos', () => {
    const r = diffCambios({ mail_pass: 'viejo' }, { mail_pass: 'nuevo' });
    expect(r.mail_pass).toEqual({ antes: '[oculto]', despues: '[oculto]' });
    expect(JSON.stringify(r)).not.toMatch(/viejo|nuevo/);
  });

  it('limita la comparación a los campos indicados', () => {
    const r = diffCambios({ a: 1, b: 1 }, { a: 2, b: 2 }, ['a']);
    expect(Object.keys(r)).toEqual(['a']);
  });

  it('recorta los valores largos', () => {
    const r = diffCambios({ t: 'x' }, { t: 'y'.repeat(500) });
    expect(r.t.despues.length).toBeLessThanOrEqual(201);
  });

  it('trata undefined como null y tolera entradas nulas', () => {
    expect(diffCambios(null, { a: 1 })).toEqual({ a: { antes: null, despues: 1 } });
    expect(diffCambios(undefined, undefined)).toBeNull();
  });
});
