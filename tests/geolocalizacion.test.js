import { describe, it, expect, afterEach } from 'vitest';
import { definirProveedorUbicacion, normalizarIp, ubicarIp } from '../src/utils/geolocalizacion.js';

afterEach(() => definirProveedorUbicacion(undefined));

describe('normalizarIp()', () => {
  it('quita el prefijo IPv4-en-IPv6 y los espacios', () => {
    expect(normalizarIp(' ::ffff:186.96.117.11 ')).toBe('186.96.117.11');
    expect(normalizarIp('2001:db8::1')).toBe('2001:db8::1');
  });

  it('descarta lo que no es texto, lo vacío y lo demasiado largo', () => {
    expect(normalizarIp(undefined)).toBeNull();
    expect(normalizarIp('   ')).toBeNull();
    expect(normalizarIp('1'.repeat(46))).toBeNull();
  });
});

describe('ubicarIp()', () => {
  it('traduce el código de región de Colombia al nombre del departamento', () => {
    definirProveedorUbicacion(() => ({ country: 'CO', region: 'CHO', city: 'Quibdó' }));
    expect(ubicarIp('1.2.3.4')).toEqual({ pais: 'CO', departamento: 'Chocó', ciudad: 'Quibdó' });
  });

  it('un código de región desconocido deja el departamento en null', () => {
    definirProveedorUbicacion(() => ({ country: 'CO', region: 'XX', city: '' }));
    expect(ubicarIp('1.2.3.4')).toEqual({ pais: 'CO', departamento: null, ciudad: null });
  });

  it('fuera de Colombia solo informa el país', () => {
    definirProveedorUbicacion(() => ({ country: 'US', region: 'TX', city: 'Austin' }));
    expect(ubicarIp('8.8.8.8')).toEqual({ pais: 'US', departamento: null, ciudad: 'Austin' });
  });

  it('devuelve null si la IP no se encuentra, no es válida o el proveedor falla', () => {
    definirProveedorUbicacion(() => null);
    expect(ubicarIp('10.0.0.1')).toBeNull();
    expect(ubicarIp(undefined)).toBeNull();
    definirProveedorUbicacion(() => { throw new Error('base corrupta'); });
    expect(ubicarIp('1.2.3.4')).toBeNull();
  });

  it('con la base real ubica una IP pública conocida', () => {
    expect(ubicarIp('8.8.8.8')).toMatchObject({ pais: 'US' });
  });
});
