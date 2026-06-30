import { describe, it, expect, vi } from 'vitest';
import { validateFile, sha256 } from '../src/middlewares/fileGuard.js';

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
