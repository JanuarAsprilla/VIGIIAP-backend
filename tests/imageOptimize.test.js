/**
 * Tests para utils/imageOptimize.js -- usa sharp de verdad (sin mock),
 * generando imágenes sintéticas en memoria en vez de fixtures en disco.
 */
import { describe, it, expect } from 'vitest';
import sharp from 'sharp';
import { optimizeImage } from '../src/utils/imageOptimize.js';

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
