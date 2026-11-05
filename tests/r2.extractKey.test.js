import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const original = { ...process.env };

beforeEach(() => {
  vi.resetModules();
  process.env.R2_PUBLIC_URL = 'https://files.test.local/privado';
  process.env.R2_PUBLIC_BUCKET_URL = 'https://files.test.local/publico/';
  process.env.R2_ACCESS_KEY_ID = 'k';
  process.env.R2_SECRET_ACCESS_KEY = 's';
  process.env.S3_ENDPOINT = 'http://localhost:9000';
});
afterEach(() => { process.env = { ...original }; });

describe('extractKey()', () => {
  it('devuelve la clave de objetos de cualquiera de los dos buckets (con o sin «/» final en la configuración)', async () => {
    const { extractKey } = await import('../src/config/r2.js');
    expect(extractKey('https://files.test.local/privado/documentos/a.pdf')).toBe('documentos/a.pdf');
    expect(extractKey('https://files.test.local/publico/avatars/b.webp')).toBe('avatars/b.webp');
  });

  it('REGRESIÓN: una URL que solo comparte el prefijo de texto con el bucket NO es una clave suya', async () => {
    const { extractKey } = await import('../src/config/r2.js');
    expect(extractKey('https://files.test.local/privado-otro/x.pdf')).toBeNull();
    expect(extractKey('https://files.test.local/publicoX/x.webp')).toBeNull();
    expect(extractKey('https://files.test.local/privado')).toBeNull();
  });

  it('rechaza URLs de otros dominios y valores vacíos', async () => {
    const { extractKey } = await import('../src/config/r2.js');
    expect(extractKey('https://evil.example/privado/x.pdf')).toBeNull();
    expect(extractKey('')).toBeNull();
    expect(extractKey(null)).toBeNull();
  });
});
