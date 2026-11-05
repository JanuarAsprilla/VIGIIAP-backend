/**
 * Tests para utils/imageOptimize.js -- usa sharp de verdad (sin mock),
 * generando imágenes sintéticas en memoria en vez de fixtures en disco.
 */
import { describe, it, expect } from 'vitest';
import sharp from 'sharp';
import { optimizeImage, MAX_PIXELES_ENTRADA } from '../src/utils/imageOptimize.js';

async function makePng(width, height) {
  return sharp({
    create: { width, height, channels: 3, background: { r: 100, g: 150, b: 200 } },
  }).png().toBuffer();
}

describe('optimizeImage()', () => {
  it('convierte a WebP', async () => {
    const input = await makePng(800, 600);
    const { buffer, mimetype, ext } = await optimizeImage(input, 'thumbnail');

    expect(mimetype).toBe('image/webp');
    expect(ext).toBe('webp');
    const meta = await sharp(buffer).metadata();
    expect(meta.format).toBe('webp');
  });

  it('redimensiona una imagen más ancha que el máximo de thumbnail (480px)', async () => {
    const input = await makePng(2000, 1000);
    const { buffer } = await optimizeImage(input, 'thumbnail');

    const meta = await sharp(buffer).metadata();
    expect(meta.width).toBe(480);
    // Proporción se mantiene (2000x1000 = 2:1)
    expect(meta.height).toBe(240);
  });

  it('redimensiona una imagen más ancha que el máximo de image (1600px)', async () => {
    const input = await makePng(3000, 1500);
    const { buffer } = await optimizeImage(input, 'image');

    const meta = await sharp(buffer).metadata();
    expect(meta.width).toBe(1600);
  });

  it('no agranda una imagen ya más chica que el máximo (withoutEnlargement)', async () => {
    const input = await makePng(200, 100);
    const { buffer } = await optimizeImage(input, 'thumbnail');

    const meta = await sharp(buffer).metadata();
    expect(meta.width).toBe(200);
    expect(meta.height).toBe(100);
  });

  it('el resultado pesa menos que el original para una imagen grande', async () => {
    const input = await makePng(2000, 2000);
    const { buffer } = await optimizeImage(input, 'thumbnail');

    expect(buffer.byteLength).toBeLessThan(input.byteLength);
  });

  it('usa los límites de "image" por defecto ante una categoría desconocida', async () => {
    const input = await makePng(3000, 1500);
    const { buffer } = await optimizeImage(input, 'algo-no-mapeado');

    const meta = await sharp(buffer).metadata();
    expect(meta.width).toBe(1600);
  });
});

describe('optimizeImage() — tope de píxeles de entrada', () => {
  /** PNG diminuto cuya cabecera declara width x height: antes de decodificar pide RAM proporcional a esas dimensiones. */
  function pngQueDeclara(width, height) {
    const tabla = Array.from({ length: 256 }, (_, n) => {
      let c = n;
      for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      return c >>> 0;
    });
    const crc32 = (buf) => {
      let c = 0xffffffff;
      for (const b of buf) c = tabla[(c ^ b) & 0xff] ^ (c >>> 8);
      return (c ^ 0xffffffff) >>> 0;
    };
    const trozo = (tipo, datos) => {
      const cuerpo = Buffer.concat([Buffer.from(tipo, 'ascii'), datos]);
      const largo = Buffer.alloc(4); largo.writeUInt32BE(datos.length);
      const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(cuerpo));
      return Buffer.concat([largo, cuerpo, crc]);
    };
    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4);
    ihdr[8] = 8; ihdr[9] = 2; // 8 bits, RGB
    return Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      trozo('IHDR', ihdr), trozo('IDAT', Buffer.from([0x78, 0x9c, 0x03, 0x00, 0x00, 0x00, 0x00, 0x01])), trozo('IEND', Buffer.alloc(0)),
    ]);
  }

  it('rechaza una imagen que declara más píxeles que el tope, sin llegar a decodificarla', async () => {
    const lado = Math.ceil(Math.sqrt(MAX_PIXELES_ENTRADA)) + 10;
    await expect(optimizeImage(pngQueDeclara(lado, lado), 'image')).rejects.toThrow(/pixel limit/i);
  });
});
