import { describe, it, expect, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { validateFile, validateFileHeader, sha256, sha256File, sanitizeFilename } from '../src/middlewares/fileGuard.js';

describe('sanitizeFilename() — REGRESIÓN content-disposition-header-injection', () => {
  it('quita comillas dobles (rompían el parámetro filename="...")', () => {
    expect(sanitizeFilename('evil".pdf"; filename="x.pdf')).not.toContain('"');
  });

  it('quita CR/LF (Node lanza TypeError si llegan a un header)', () => {
    const resultado = sanitizeFilename('archivo\r\nX-Injected: 1.pdf');
    expect(resultado).not.toMatch(/[\r\n]/);
  });

  it('nombre normal sin caracteres peligrosos no cambia de forma inesperada', () => {
    expect(sanitizeFilename('informe-final.pdf')).toBe('informe-final.pdf');
  });
});

function archivoTemporalCon(bytes) {
  const ruta = path.join(os.tmpdir(), `fileguard-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  fs.writeFileSync(ruta, Buffer.from(bytes));
  return ruta;
}

// ─── Helper para construir un fake multer file ────────────────────────────────

function makeFile(magicBytes, name = 'file.pdf', mimeType = 'application/pdf') {
  const buf = Buffer.alloc(32, 0);
  magicBytes.forEach((b, i) => { buf[i] = b; });
  return { buffer: buf, originalname: name, mimetype: mimeType, size: buf.length };
}

// ─── PDF ──────────────────────────────────────────────────────────────────────

describe('validateFile() — PDF', () => {
  const PDF_MAGIC = [0x25, 0x50, 0x44, 0x46]; // %PDF

  it('acepta un PDF válido', () => {
    const file = makeFile(PDF_MAGIC, 'informe.pdf', 'application/pdf');
    const result = validateFile(file, 'document');
    expect(result.valid).toBe(true);
    expect(result.sanitizedExt).toBe('pdf');
    expect(result.hash).toBeTruthy();
  });

  it('rechaza PDF con magic bytes incorrectos', () => {
    const file = makeFile([0x00, 0x00, 0x00, 0x00], 'fake.pdf', 'application/pdf');
    const result = validateFile(file, 'document');
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/contenido/i);
  });

  it('rechaza PDF con MIME type incorrecto del cliente', () => {
    const file = makeFile(PDF_MAGIC, 'informe.pdf', 'text/html');
    const result = validateFile(file, 'document');
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/MIME/i);
  });

  it('acepta PDF con MIME application/octet-stream (navegadores antiguos)', () => {
    const file = makeFile(PDF_MAGIC, 'informe.pdf', 'application/octet-stream');
    const result = validateFile(file, 'document');
    expect(result.valid).toBe(true);
  });
});

// ─── JPEG ─────────────────────────────────────────────────────────────────────

describe('validateFile() — JPEG', () => {
  const JPEG_MAGIC = [0xFF, 0xD8, 0xFF];

  it('acepta un JPEG válido en categoría image', () => {
    const file = makeFile(JPEG_MAGIC, 'foto.jpg', 'image/jpeg');
    const result = validateFile(file, 'image');
    expect(result.valid).toBe(true);
    expect(result.sanitizedExt).toBe('jpg');
  });

  it('acepta .jpeg con magic bytes correctos', () => {
    const file = makeFile(JPEG_MAGIC, 'foto.jpeg', 'image/jpeg');
    const result = validateFile(file, 'image');
    expect(result.valid).toBe(true);
    expect(result.sanitizedExt).toBe('jpeg');
  });

  it('rechaza JPEG con magic bytes incorrectos', () => {
    const file = makeFile([0xAA, 0xBB, 0xCC], 'fake.jpg', 'image/jpeg');
    const result = validateFile(file, 'image');
    expect(result.valid).toBe(false);
  });
});

// ─── PNG ──────────────────────────────────────────────────────────────────────

describe('validateFile() — PNG', () => {
  const PNG_MAGIC = [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A];

  it('acepta un PNG válido', () => {
    const file = makeFile(PNG_MAGIC, 'imagen.png', 'image/png');
    const result = validateFile(file, 'image');
    expect(result.valid).toBe(true);
  });

  it('acepta PNG en categoría thumbnail', () => {
    const file = makeFile(PNG_MAGIC, 'thumb.png', 'image/png');
    const result = validateFile(file, 'thumbnail');
    expect(result.valid).toBe(true);
  });
});

// ─── WebP ─────────────────────────────────────────────────────────────────────

describe('validateFile() — WebP', () => {
  it('acepta un WebP válido (RIFF....WEBP)', () => {
    const buf = Buffer.alloc(32, 0);
    // RIFF at offset 0
    [0x52, 0x49, 0x46, 0x46].forEach((b, i) => { buf[i] = b; });
    // WEBP at offset 8
    [0x57, 0x45, 0x42, 0x50].forEach((b, i) => { buf[8 + i] = b; });
    const file = { buffer: buf, originalname: 'img.webp', mimetype: 'image/webp', size: buf.length };
    const result = validateFile(file, 'image');
    expect(result.valid).toBe(true);
  });

  it('rechaza WebP con bytes incorrectos en offset 8', () => {
    const buf = Buffer.alloc(32, 0);
    [0x52, 0x49, 0x46, 0x46].forEach((b, i) => { buf[i] = b; });
    // Wrong bytes at offset 8
    [0x00, 0x00, 0x00, 0x00].forEach((b, i) => { buf[8 + i] = b; });
    const file = { buffer: buf, originalname: 'img.webp', mimetype: 'image/webp', size: buf.length };
    const result = validateFile(file, 'image');
    expect(result.valid).toBe(false);
  });
});

// ─── GIF ──────────────────────────────────────────────────────────────────────

describe('validateFile() — GIF', () => {
  it('acepta GIF89a', () => {
    const buf = Buffer.from([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, ...Array(26).fill(0)]);
    const file = { buffer: buf, originalname: 'anim.gif', mimetype: 'image/gif', size: buf.length };
    const result = validateFile(file, 'image');
    expect(result.valid).toBe(true);
  });

  it('acepta GIF87a', () => {
    const buf = Buffer.from([0x47, 0x49, 0x46, 0x38, 0x37, 0x61, ...Array(26).fill(0)]);
    const file = { buffer: buf, originalname: 'old.gif', mimetype: 'image/gif', size: buf.length };
    const result = validateFile(file, 'image');
    expect(result.valid).toBe(true);
  });
});

// ─── Ejecutables / Malware ────────────────────────────────────────────────────

describe('validateFile() — ejecutables bloqueados', () => {
  it('rechaza Windows PE/EXE (MZ header)', () => {
    const file = makeFile([0x4D, 0x5A], 'malware.pdf', 'application/pdf');
    const result = validateFile(file, 'document');
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/malicioso/i);
  });

  it('rechaza ELF Linux executable', () => {
    const file = makeFile([0x7F, 0x45, 0x4C, 0x46], 'virus.pdf', 'application/pdf');
    const result = validateFile(file, 'document');
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/malicioso/i);
  });

  it('rechaza ZIP disfrazado de PDF', () => {
    const file = makeFile([0x50, 0x4B, 0x03, 0x04], 'archive.pdf', 'application/pdf');
    const result = validateFile(file, 'document');
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/malicioso/i);
  });

  it('rechaza script shebang (#!)', () => {
    const file = makeFile([0x23, 0x21], 'script.pdf', 'application/pdf');
    const result = validateFile(file, 'document');
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/malicioso/i);
  });

  it('rechaza Java class file (CAFEBABE)', () => {
    const file = makeFile([0xCA, 0xFE, 0xBA, 0xBE], 'evil.pdf', 'application/pdf');
    const result = validateFile(file, 'document');
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/malicioso/i);
  });

  it('rechaza archivo OLE legacy (Office con macros)', () => {
    const file = makeFile([0xD0, 0xCF, 0x11, 0xE0], 'macro.doc', 'application/pdf');
    const result = validateFile(file, 'document');
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/malicioso/i);
  });
});

// ─── Casos de error de extensión / categoría ──────────────────────────────────

describe('validateFile() — errores de extensión y categoría', () => {
  it('rechaza archivo vacío', () => {
    const file = { buffer: Buffer.alloc(0), originalname: 'empty.pdf', mimetype: 'application/pdf', size: 0 };
    const result = validateFile(file, 'document');
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/vacío/i);
  });

  it('rechaza si la categoría es desconocida', () => {
    const file = makeFile([0x25, 0x50, 0x44, 0x46], 'file.pdf', 'application/pdf');
    const result = validateFile(file, 'invalid-category');
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/categoría/i);
  });

  it('rechaza archivo sin extensión', () => {
    const file = makeFile([0x25, 0x50, 0x44, 0x46], 'sinextension', 'application/pdf');
    const result = validateFile(file, 'document');
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/extensión/i);
  });

  it('rechaza extensión no permitida para la categoría', () => {
    // .pdf no está en categoría thumbnail (que solo admite jpeg/png/webp)
    const file = makeFile([0x25, 0x50, 0x44, 0x46], 'doc.pdf', 'application/pdf');
    const result = validateFile(file, 'thumbnail');
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/no permitida/i);
  });

  it('rechaza doble extensión — usa solo la última (shell.php.pdf)', () => {
    // La extensión final es 'pdf', debe validarse como PDF
    const PDF_MAGIC = [0x25, 0x50, 0x44, 0x46];
    const file = makeFile(PDF_MAGIC, 'shell.php.pdf', 'application/pdf');
    const result = validateFile(file, 'document');
    // El archivo tiene magic bytes de PDF, así que pasa
    expect(result.valid).toBe(true);
    expect(result.sanitizedExt).toBe('pdf');
  });
});

// ─── Video (fichas por punto) ──────────────────────────────────────────────────

describe('validateFile() — video (categoría medioFicha)', () => {
  it('acepta un MP4 válido (ftyp en offset 4)', () => {
    const buf = Buffer.alloc(32, 0);
    [0x66, 0x74, 0x79, 0x70].forEach((b, i) => { buf[4 + i] = b; }); // ftyp
    const file = { buffer: buf, originalname: 'video.mp4', mimetype: 'video/mp4', size: buf.length };
    const result = validateFile(file, 'medioFicha');
    expect(result.valid).toBe(true);
    expect(result.mime).toBe('video/mp4');
  });

  it('acepta un MOV válido (mismo contenedor ISO-BMFF)', () => {
    const buf = Buffer.alloc(32, 0);
    [0x66, 0x74, 0x79, 0x70].forEach((b, i) => { buf[4 + i] = b; });
    const file = { buffer: buf, originalname: 'video.mov', mimetype: 'video/quicktime', size: buf.length };
    const result = validateFile(file, 'medioFicha');
    expect(result.valid).toBe(true);
    expect(result.mime).toBe('video/quicktime');
  });

  it('acepta un WebM válido (cabecera EBML)', () => {
    const buf = Buffer.alloc(32, 0);
    [0x1A, 0x45, 0xDF, 0xA3].forEach((b, i) => { buf[i] = b; });
    const file = { buffer: buf, originalname: 'video.webm', mimetype: 'video/webm', size: buf.length };
    const result = validateFile(file, 'medioFicha');
    expect(result.valid).toBe(true);
    expect(result.mime).toBe('video/webm');
  });

  it('rechaza un .mp4 sin la caja ftyp real (contenido falsificado)', () => {
    const buf = Buffer.alloc(32, 0);
    const file = { buffer: buf, originalname: 'falso.mp4', mimetype: 'video/mp4', size: buf.length };
    const result = validateFile(file, 'medioFicha');
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/contenido/i);
  });

  it('la categoría medioFicha también acepta imágenes (jpeg/png/webp)', () => {
    const buf = Buffer.alloc(32, 0);
    [0xFF, 0xD8, 0xFF].forEach((b, i) => { buf[i] = b; });
    const file = { buffer: buf, originalname: 'foto.jpg', mimetype: 'image/jpeg', size: buf.length };
    const result = validateFile(file, 'medioFicha');
    expect(result.valid).toBe(true);
    expect(result.mime).toBe('image/jpeg');
  });

  it('rechaza un ZIP (malware) disfrazado de .mp4', () => {
    const buf = Buffer.alloc(32, 0);
    [0x50, 0x4B, 0x03, 0x04].forEach((b, i) => { buf[i] = b; }); // PK.. en offset 0
    [0x66, 0x74, 0x79, 0x70].forEach((b, i) => { buf[4 + i] = b; }); // ftyp también presente
    const file = { buffer: buf, originalname: 'evil.mp4', mimetype: 'video/mp4', size: buf.length };
    const result = validateFile(file, 'medioFicha');
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/malicioso/i);
  });
});

// ─── validateFileHeader() / sha256File() — archivos en disco ───────────────────

describe('validateFileHeader() — misma validación que validateFile pero desde disco', () => {
  it('acepta un MP4 válido leído de un archivo real', () => {
    const bytes = Buffer.alloc(64, 0);
    [0x66, 0x74, 0x79, 0x70].forEach((b, i) => { bytes[4 + i] = b; });
    const ruta = archivoTemporalCon(bytes);

    const result = validateFileHeader(ruta, 'video.mp4', 'video/mp4', 'medioFicha');

    expect(result.valid).toBe(true);
    fs.rmSync(ruta, { force: true });
  });

  it('rechaza un archivo cuyo contenido no corresponde a la extensión', () => {
    const ruta = archivoTemporalCon(Buffer.alloc(32, 0));

    const result = validateFileHeader(ruta, 'video.webm', 'video/webm', 'medioFicha');

    expect(result.valid).toBe(false);
    fs.rmSync(ruta, { force: true });
  });

  it('funciona con un archivo más grande que el header leído (no carga el archivo completo)', () => {
    const bytes = Buffer.alloc(5 * 1024 * 1024, 0); // 5 MB, muy por encima de HEADER_BYTES
    [0x1A, 0x45, 0xDF, 0xA3].forEach((b, i) => { bytes[i] = b; });
    const ruta = archivoTemporalCon(bytes);

    const result = validateFileHeader(ruta, 'grande.webm', 'video/webm', 'medioFicha');

    expect(result.valid).toBe(true);
    fs.rmSync(ruta, { force: true });
  });
});

describe('sha256File()', () => {
  it('calcula el mismo hash que sha256() sobre el buffer equivalente', async () => {
    const contenido = 'contenido de prueba para hash de archivo';
    const ruta = archivoTemporalCon(Buffer.from(contenido));

    const hashArchivo = await sha256File(ruta);

    expect(hashArchivo).toBe(sha256(Buffer.from(contenido)));
    fs.rmSync(ruta, { force: true });
  });
});

// ─── sha256() ─────────────────────────────────────────────────────────────────

describe('sha256()', () => {
  it('retorna un digest hexadecimal de 64 caracteres', () => {
    const hash = sha256(Buffer.from('vigiiap'));
    expect(typeof hash).toBe('string');
    expect(hash).toHaveLength(64);
    expect(hash).toMatch(/^[0-9a-f]+$/);
  });

  it('devuelve hash consistente para el mismo buffer', () => {
    const buf = Buffer.from('IIAP');
    expect(sha256(buf)).toBe(sha256(buf));
  });

  it('devuelve hashes diferentes para buffers distintos', () => {
    expect(sha256(Buffer.from('a'))).not.toBe(sha256(Buffer.from('b')));
  });
});
