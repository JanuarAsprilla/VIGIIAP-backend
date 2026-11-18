import { describe, it, expect, vi } from 'vitest';
import { limitesMultipart, topeContentLength, guardaContentLength } from '../src/middlewares/multipartLimits.js';

describe('limitesMultipart()', () => {
  it('acota archivos, campos de texto, partes y pares de cabecera', () => {
    expect(limitesMultipart({ fileSize: 1000, files: 2 })).toEqual({
      fileSize: 1000, files: 2, fields: 60, fieldSize: 128 * 1024, parts: 62, headerPairs: 100,
    });
  });
});

describe('guardaContentLength()', () => {
  const tope = topeContentLength({ fileSize: 10 * 1024 * 1024, files: 1 });

  function pasar(contentLength) {
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn() };
    const next = vi.fn();
    guardaContentLength(tope)({ headers: contentLength === undefined ? {} : { 'content-length': contentLength } }, res, next);
    return { res, next };
  }

  it('el tope es el tamaño del archivo por el número de archivos y el margen x3', () => {
    expect(tope).toBe(30 * 1024 * 1024);
  });

  it('rechaza con 413 una petición que declara más que el tope', () => {
    const { res, next } = pasar(String(tope + 1));
    expect(res.status).toHaveBeenCalledWith(413);
    expect(next).not.toHaveBeenCalled();
  });

  it('deja pasar una petición dentro del tope y las que no declaran Content-Length (el límite de multer las acota)', () => {
    expect(pasar(String(tope)).next).toHaveBeenCalled();
    expect(pasar(undefined).next).toHaveBeenCalled();
  });
});
