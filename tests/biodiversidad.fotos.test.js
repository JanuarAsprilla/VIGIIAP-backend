import { describe, it, expect } from 'vitest';
import { fotosPublicas, fotoValida } from '../src/modules/biodiversidad/consultas/fotos.js';
import { patronBusqueda } from '../src/modules/biodiversidad/consultas/texto.js';

const IMAGEN = `https://api.gbif.org/v1/image/cache/500x/occurrence/5036794008/media/${'a1'.repeat(16)}`;
const buena = (extra = {}) => ({
  imagen: IMAGEN, autor: 'Ana', editor: 'iNaturalist', licencia: 'CC-BY', referencia: 'https://www.inaturalist.org/photos/1', ...extra,
});

describe('fotoValida()', () => {
  it('acepta una imagen de la caché de GBIF con referencia https', () => {
    expect(fotoValida(buena())).toBe(true);
  });

  it.each([
    ['URL original del autor (S3)', { imagen: 'https://inaturalist-open-data.s3.amazonaws.com/photos/1/original.jpeg' }],
    ['http sin cifrar', { imagen: IMAGEN.replace('https', 'http') }],
    ['otro host que termina igual', { imagen: IMAGEN.replace('api.gbif.org', 'api.gbif.org.evil.com') }],
    ['subdominio con arroba', { imagen: IMAGEN.replace('api.gbif.org', 'api.gbif.org@evil.com') }],
    ['hash corto', { imagen: IMAGEN.slice(0, -1) }],
    ['hash con mayúsculas', { imagen: IMAGEN.toUpperCase().replace('HTTPS', 'https') }],
    ['salto de línea al final', { imagen: `${IMAGEN}\n` }],
    ['sufijo extra', { imagen: `${IMAGEN}/x` }],
    ['sin imagen', { imagen: undefined }],
    ['imagen no es texto', { imagen: 5 }],
    ['referencia http', { referencia: 'http://www.inaturalist.org/photos/1' }],
    ['referencia javascript:', { referencia: 'javascript:alert(1)' }],
    ['sin referencia', { referencia: null }],
  ])('descarta: %s', (_nombre, cambio) => {
    expect(fotoValida(buena(cambio))).toBe(false);
  });

  it('descarta valores que no son objetos', () => {
    for (const x of [null, undefined, 'texto', 7, [], [buena()]]) expect(fotoValida(x)).toBe(false);
  });
});

describe('fotosPublicas()', () => {
  it('entrega solo los cinco campos públicos, nunca original ni origen', () => {
    const [f] = fotosPublicas([buena({ original: 'https://s3/x.jpeg', origen: 'interno', gbif_id: '1' })]);
    expect(Object.keys(f).sort()).toEqual(['autor', 'editor', 'imagen', 'licencia', 'referencia']);
  });

  it('descarta las inválidas y conserva el orden de las válidas', () => {
    const a = buena({ autor: 'A' });
    const b = buena({ autor: 'B', imagen: IMAGEN.replace('5036794008', '99') });
    const r = fotosPublicas([a, buena({ imagen: 'https://evil.example/x.jpg' }), b]);
    expect(r.map((f) => f.autor)).toEqual(['A', 'B']);
  });

  it('completa con null los campos opcionales ausentes', () => {
    const [f] = fotosPublicas([{ imagen: IMAGEN, referencia: 'https://www.inaturalist.org/photos/1' }]);
    expect(f).toEqual({ imagen: IMAGEN, autor: null, editor: null, licencia: null, referencia: 'https://www.inaturalist.org/photos/1' });
  });

  it('tolera entradas que no son un arreglo', () => {
    for (const x of [null, undefined, {}, 'x', 3]) expect(fotosPublicas(x)).toEqual([]);
  });
});

describe('patronBusqueda()', () => {
  it('escapa los comodines de LIKE y la barra invertida', () => {
    expect(patronBusqueda('50%_\\x')).toBe('%50\\%\\_\\\\x%');
  });

  it('pasa a minúsculas y quita acentos', () => {
    expect(patronBusqueda('Pecarí ÑANDÚ')).toBe('%pecari nandu%');
  });

  it('no altera comillas ni punto y coma: el valor siempre viaja como parámetro', () => {
    expect(patronBusqueda("x'; DROP TABLE y;--")).toBe("%x'; drop table y;--%");
  });
});
