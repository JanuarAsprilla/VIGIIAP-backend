import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ocultarId, resolverIdOpaco, idVisible, idRealDesdeUrl, PATRON_ID_OPACO } from '../src/modules/biodiversidad/consultas/idOpaco.js';

const original = process.env.JWT_SECRET;
beforeEach(() => { process.env.JWT_SECRET = 'secreto-de-prueba-'.padEnd(40, 'x'); });
afterEach(() => { process.env.JWT_SECRET = original; });

describe('id opaco de registros con ubicación reservada', () => {
  it('no contiene el gbif_id, es determinista y se resuelve al id real', () => {
    const t = ocultarId('5282328258');
    expect(t).toMatch(PATRON_ID_OPACO);
    expect(t).not.toContain('5282328258');
    expect(ocultarId('5282328258')).toBe(t);
    expect(ocultarId('5282328259')).not.toBe(t);
    expect(resolverIdOpaco(t)).toBe('5282328258');
  });

  it('un token manipulado, truncado o de otra clave no se resuelve', () => {
    const t = ocultarId('123456');
    const alterado = `${t.slice(0, -2)}${t.endsWith('AA') ? 'BB' : 'AA'}`;
    expect(resolverIdOpaco(alterado)).toBeNull();
    expect(resolverIdOpaco(t.slice(0, 30))).toBeNull();
    expect(resolverIdOpaco('oAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA')).toBeNull();
    process.env.JWT_SECRET = 'otra-clave-completamente-distinta-xxxxxxxx';
    expect(resolverIdOpaco(t)).toBeNull();
  });

  it('idVisible: el real si la ubicación es pública, el opaco si está reservada', () => {
    expect(idVisible('99', false)).toBe('99');
    expect(idVisible('99', true)).toMatch(PATRON_ID_OPACO);
  });

  it('idRealDesdeUrl resuelve el opaco, deja pasar el real (ya validado por la ruta) y rechaza un token inválido', () => {
    expect(idRealDesdeUrl('12345')).toBe('12345');
    expect(idRealDesdeUrl(ocultarId('12345'))).toBe('12345');
    expect(idRealDesdeUrl('oAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA')).toBeNull();
    expect(idRealDesdeUrl(undefined)).toBeNull();
  });

  it('sin JWT_SECRET falla en lugar de usar una clave vacía', () => {
    delete process.env.JWT_SECRET;
    expect(() => ocultarId('1')).toThrow(/JWT_SECRET/);
  });
});
