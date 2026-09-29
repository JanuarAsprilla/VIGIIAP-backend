/**
 * Tests del paso de validación de uploadMedioFicha (fichasMedios.middleware.js)
 * -- el parseo multipart en sí (multer.diskStorage) requiere una petición HTTP
 * real y no se prueba aquí; se ejercita el paso de validación directamente con
 * archivos reales en disco (simula lo que multer ya habría escrito).
 */
import { describe, it, expect, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { uploadMedioFicha } from '../src/modules/fichas/fichasMedios.middleware.js';

const pasoValidacion = uploadMedioFicha.at(-1); // último middleware del array: valida el archivo ya escrito a disco

function archivoTemporalCon(bytes) {
  const ruta = path.join(os.tmpdir(), `medio-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  fs.writeFileSync(ruta, Buffer.from(bytes));
  return ruta;
}

function mockRes() {
  const res = {};
  res.status = (code) => { res.statusCode = code; return res; };
  res.json = (body) => { res.body = body; return res; };
  return res;
}

const MP4_HEADER = (() => {
  const buf = Buffer.alloc(32, 0);
  [0x66, 0x74, 0x79, 0x70].forEach((b, i) => { buf[4 + i] = b; }); // ftyp
  return buf;
})();

const JPEG_HEADER = Buffer.from([0xFF, 0xD8, 0xFF, ...Array(29).fill(0)]);

let archivosACleanup = [];
afterEach(() => {
  archivosACleanup.forEach((p) => fs.rmSync(p, { force: true }));
  archivosACleanup = [];
});

describe('uploadMedioFicha — paso de validación', () => {
  it('resuelve tipo=imagen para un JPEG y deja req.medioFicha listo', () => {
    const rutaArchivo = archivoTemporalCon(JPEG_HEADER);
    archivosACleanup.push(rutaArchivo);
    const req = { files: { archivo: [{ path: rutaArchivo, originalname: 'foto.jpg', mimetype: 'image/jpeg', size: JPEG_HEADER.length }] } };
    const res = mockRes();
    let siguienteLlamado = false;

    pasoValidacion(req, res, () => { siguienteLlamado = true; });

    expect(siguienteLlamado).toBe(true);
    expect(req.medioFicha).toMatchObject({ tipo: 'imagen', path: rutaArchivo });
    expect(req.medioFicha.posterPath).toBeUndefined();
  });

  it('resuelve tipo=video para un MP4 y conserva el poster si viene', () => {
    const rutaArchivo = archivoTemporalCon(MP4_HEADER);
    const rutaPoster = archivoTemporalCon(JPEG_HEADER);
    archivosACleanup.push(rutaArchivo, rutaPoster);
    const req = {
      files: {
        archivo: [{ path: rutaArchivo, originalname: 'video.mp4', mimetype: 'video/mp4', size: MP4_HEADER.length }],
        poster: [{ path: rutaPoster, originalname: 'poster.jpg', mimetype: 'image/jpeg', size: JPEG_HEADER.length }],
      },
    };
    const res = mockRes();
    let siguienteLlamado = false;

    pasoValidacion(req, res, () => { siguienteLlamado = true; });

    expect(siguienteLlamado).toBe(true);
    expect(req.medioFicha).toMatchObject({ tipo: 'video', path: rutaArchivo, posterPath: rutaPoster });
  });

  it('descarta el poster (sin error) si llega junto a una imagen', () => {
    const rutaArchivo = archivoTemporalCon(JPEG_HEADER);
    const rutaPoster = archivoTemporalCon(JPEG_HEADER);
    archivosACleanup.push(rutaArchivo); // rutaPoster se borra dentro del propio middleware
    const req = {
      files: {
        archivo: [{ path: rutaArchivo, originalname: 'foto.jpg', mimetype: 'image/jpeg', size: JPEG_HEADER.length }],
        poster: [{ path: rutaPoster, originalname: 'poster.jpg', mimetype: 'image/jpeg', size: JPEG_HEADER.length }],
      },
    };
    const res = mockRes();

    pasoValidacion(req, res, () => {});

    expect(req.medioFicha.posterPath).toBeUndefined();
    expect(fs.existsSync(rutaPoster)).toBe(false);
  });

  it('rechaza 400 si falta el archivo principal', () => {
    const req = { files: {} };
    const res = mockRes();
    let siguienteLlamado = false;

    pasoValidacion(req, res, () => { siguienteLlamado = true; });

    expect(siguienteLlamado).toBe(false);
    expect(res.statusCode).toBe(400);
  });

  it('rechaza 422 y borra el archivo si el contenido no corresponde a la extensión', () => {
    const rutaArchivo = archivoTemporalCon(Buffer.alloc(32, 0)); // sin magic bytes válidos
    const req = { files: { archivo: [{ path: rutaArchivo, originalname: 'foto.jpg', mimetype: 'image/jpeg', size: 32 }] } };
    const res = mockRes();
    let siguienteLlamado = false;

    pasoValidacion(req, res, () => { siguienteLlamado = true; });

    expect(siguienteLlamado).toBe(false);
    expect(res.statusCode).toBe(422);
    expect(fs.existsSync(rutaArchivo)).toBe(false);
  });

  it('rechaza 422 si una imagen supera los 15 MB', () => {
    const rutaArchivo = archivoTemporalCon(JPEG_HEADER);
    archivosACleanup = archivosACleanup.filter((p) => p !== rutaArchivo); // se borra dentro del middleware
    const req = { files: { archivo: [{ path: rutaArchivo, originalname: 'foto.jpg', mimetype: 'image/jpeg', size: 16 * 1024 * 1024 }] } };
    const res = mockRes();

    pasoValidacion(req, res, () => {});

    expect(res.statusCode).toBe(422);
    expect(res.body.error).toMatch(/15 MB/);
    expect(fs.existsSync(rutaArchivo)).toBe(false);
  });

  it('acepta un video de hasta 300 MB (no aplica el límite de imagen)', () => {
    const rutaArchivo = archivoTemporalCon(MP4_HEADER);
    archivosACleanup.push(rutaArchivo);
    const req = { files: { archivo: [{ path: rutaArchivo, originalname: 'video.mp4', mimetype: 'video/mp4', size: 250 * 1024 * 1024 }] } };
    const res = mockRes();
    let siguienteLlamado = false;

    pasoValidacion(req, res, () => { siguienteLlamado = true; });

    expect(siguienteLlamado).toBe(true);
  });
});
