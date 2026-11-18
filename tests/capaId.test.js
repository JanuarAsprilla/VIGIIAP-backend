import { describe, it, expect } from 'vitest';
import { esCapaIdValido, validarCapaId } from '../src/modules/geovisores/capaId.js';

describe('validarCapaId()', () => {
  it.each(['t_01_biodiversidad:especies', 'ws:capa_1', 'ws:capa-2.v3'])('acepta %s', (id) => {
    expect(validarCapaId(id)).toBe(id);
  });

  it.each([
    ['lista con coma', 'ws:a,otro:b'],
    ['espacio interno', 'ws:a b'],
    ['espacio al borde', ' ws:a'],
    ['sin workspace', 'capa'],
    ['dos separadores', 'a:b:c'],
    ['nombre vacío', 'ws:'],
    ['workspace vacío', ':capa'],
    ['salto de línea', 'ws:a\nb'],
    ['no texto', ['ws:a']],
    ['vacío', ''],
    ['undefined', undefined],
  ])('rechaza con 400 %s', (_nombre, id) => {
    expect(esCapaIdValido(id)).toBe(false);
    expect(() => validarCapaId(id)).toThrowError(expect.objectContaining({ status: 400, code: 'CAPA_ID_INVALIDO' }));
  });
});
