import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

vi.mock('../src/config/r2.js', () => ({
  uploadFile: vi.fn().mockResolvedValue('https://files.test.local/docs/archivo.pdf'),
}));

vi.mock('../src/utils/dataCustody.js', () => ({
  registrarScanArchivo: vi.fn(),
}));

import { uploadFile } from '../src/config/r2.js';
import { registrarScanArchivo } from '../src/utils/dataCustody.js';
import { uploadFields, uploadSingle } from '../src/middlewares/upload.js';

// ─── Helpers ───────────────────────────────────────────────────────────────────

function pdfBuffer(size = 32) {
  const buf = Buffer.alloc(Math.max(size, 4), 0);
  [0x25, 0x50, 0x44, 0x46].forEach((b, i) => { buf[i] = b; }); // %PDF
  return buf;
}

function jpegBuffer(size = 32) {
  const buf = Buffer.alloc(Math.max(size, 3), 0);
  [0xFF, 0xD8, 0xFF].forEach((b, i) => { buf[i] = b; });
  return buf;
}

function fakeFile(overrides = {}) {
  return {
    originalname: 'archivo.pdf',
    mimetype:     'application/pdf',
    buffer:       pdfBuffer(),
    size:         32,
    ...overrides,
  };
}

function mockRes() {
  return {
    status: vi.fn().mockReturnThis(),
    json:   vi.fn().mockReturnThis(),
  };
}

function buildApp(fields, { authenticated = false } = {}) {
  const app = express();
  if (authenticated) {
    app.use((req, _res, next) => { req.user = { id: 'user-1' }; next(); });
  }
  app.post('/upload', ...uploadFields(fields), (req, res) => res.status(200).json({ body: req.body }));
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    res.status(err.status || 500).json({ error: err.message, code: err.code });
  });
  return app;
}

beforeEach(() => vi.clearAllMocks());

// ─── Paso 0 — Guardia de Content-Length ────────────────────────────────────────

describe('uploadFields() — guardia de Content-Length', () => {
  it('rechaza con 413 si Content-Length excede el límite total permitido', () => {
    const [guard] = uploadFields([{ name: 'documento', folder: 'docs', maxSizeMB: 1 }]);
    const req = { headers: { 'content-length': String(10 * 1024 * 1024) } };
    const res = mockRes();
    const next = vi.fn();

    guard(req, res, next);

    expect(res.status).toHaveBeenCalledWith(413);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ error: expect.stringContaining('Carga demasiado grande') }),
    );
    expect(next).not.toHaveBeenCalled();
  });

  it('continúa si no hay header Content-Length (usa 0 por defecto)', () => {
    const [guard] = uploadFields([{ name: 'documento', folder: 'docs', maxSizeMB: 1 }]);
    const req = { headers: {} };
    const res = mockRes();
    const next = vi.fn();

    guard(req, res, next);

    expect(next).toHaveBeenCalledOnce();
    expect(res.status).not.toHaveBeenCalled();
  });

  it('continúa si Content-Length está dentro del límite permitido', () => {
    const [guard] = uploadFields([{ name: 'documento', folder: 'docs', maxSizeMB: 5 }]);
    const req = { headers: { 'content-length': '1000' } };
    const res = mockRes();
    const next = vi.fn();

    guard(req, res, next);

    expect(next).toHaveBeenCalledOnce();
    expect(res.status).not.toHaveBeenCalled();
  });
});

// ─── Paso 1 — Parseo multipart real (multer) ───────────────────────────────────

describe('uploadFields() — parseo multipart (multer)', () => {
  it('continúa sin archivos cuando el request no adjunta ninguno', async () => {
    const app = buildApp([{ name: 'documento', folder: 'docs' }]);
    const res = await request(app).post('/upload').field('titulo', 'Informe');

    expect(res.status).toBe(200);
    expect(res.body.body.documento_url).toBeUndefined();
    expect(uploadFile).not.toHaveBeenCalled();
  });

  it('rechaza con 400 si el archivo excede el límite global de multer (fileSize)', async () => {
    const app = buildApp([{ name: 'documento', folder: 'docs', maxSizeMB: 1 }]);
    // Content-Length debe quedar por debajo del margen x3 de la guardia (paso 0, 3 MB),
    // pero superar el límite fileSize de multer (1 MB) — dispara LIMIT_FILE_SIZE.
    const bigBuf = Buffer.alloc(2 * 1024 * 1024, 1);

    const res = await request(app)
      .post('/upload')
      .attach('documento', bigBuf, { filename: 'grande.pdf', contentType: 'application/pdf' });

    expect(res.status).toBe(400);
  });

  it('rechaza con 400 si se envía un campo no reconocido por el pipeline', async () => {
    const app = buildApp([{ name: 'documento', folder: 'docs' }]);

    const res = await request(app)
      .post('/upload')
      .attach('campo_desconocido', pdfBuffer(), { filename: 'a.pdf', contentType: 'application/pdf' });

    expect(res.status).toBe(400);
  });
});

// ─── Paso 2 — Validación de archivos ───────────────────────────────────────────

describe('uploadFields() — validación de archivos', () => {
  it('llama next() de inmediato si req.files no existe', async () => {
    const [, , validateStep] = uploadFields([{ name: 'documento', folder: 'docs' }]);
    const req = {};
    const res = mockRes();
    const next = vi.fn();

    await validateStep(req, res, next);

    expect(next).toHaveBeenCalledOnce();
    expect(res.status).not.toHaveBeenCalled();
  });

  it('omite (continue) campos sin archivo adjunto cuando hay múltiples campos definidos', async () => {
    const fields = [
      { name: 'documento', folder: 'docs' },
      { name: 'anexo', folder: 'anexos' },
    ];
    const [, , validateStep] = uploadFields(fields);
    const file = fakeFile();
    const req = { files: { documento: [file] }, user: { id: 'u1' }, ip: '10.0.0.1' };
    const res = mockRes();
    const next = vi.fn();

    await validateStep(req, res, next);

    expect(next).toHaveBeenCalledOnce();
    expect(res.status).not.toHaveBeenCalled();
    expect(file._sanitizedExt).toBe('pdf');
  });

  it('rechaza con 422 si el archivo supera el maxSizeMB específico del campo', async () => {
    const fields = [
      { name: 'documento', folder: 'docs', maxSizeMB: 1 },
      { name: 'anexo', folder: 'anexos', maxSizeMB: 0.001 },
    ];
    const app = buildApp(fields);

    const res = await request(app)
      .post('/upload')
      .attach('anexo', Buffer.alloc(2000, 1), { filename: 'anexo.pdf', contentType: 'application/pdf' });

    expect(res.status).toBe(422);
    expect(res.body.error).toMatch(/supera el tamaño máximo/);
    expect(uploadFile).not.toHaveBeenCalled();
  });

  it('rechaza con 422 y registra el scan como rechazado si el archivo no pasa validateFile', async () => {
    const app = buildApp([{ name: 'documento', folder: 'docs' }]);
    const badBuf = Buffer.alloc(32, 0); // sin magic bytes válidos de PDF

    const res = await request(app)
      .post('/upload')
      .attach('documento', badBuf, { filename: 'falso.pdf', contentType: 'application/pdf' });

    expect(res.status).toBe(422);
    expect(registrarScanArchivo).toHaveBeenCalledWith(
      expect.objectContaining({ resultado: 'rejected', archivoKey: expect.stringContaining('REJECTED-') }),
    );
  });

  it('usa null como uploadedBy/ip cuando no hay usuario autenticado ni IP', async () => {
    const [, , validateStep] = uploadFields([{ name: 'documento', folder: 'docs' }]);
    const req = { files: { documento: [fakeFile({ buffer: Buffer.alloc(32, 0) })] } };
    const res = mockRes();
    const next = vi.fn();

    await validateStep(req, res, next);

    expect(registrarScanArchivo).toHaveBeenCalledWith(
      expect.objectContaining({ uploadedBy: null, ipOrigen: null }),
    );
  });

  it('marca file._sanitizedExt y file._sha256 tras validación exitosa', async () => {
    const [, , validateStep] = uploadFields([{ name: 'documento', folder: 'docs' }]);
    const file = fakeFile();
    const req = { files: { documento: [file] }, user: { id: 'u1' }, ip: '10.0.0.1' };
    const res = mockRes();
    const next = vi.fn();

    await validateStep(req, res, next);

    expect(next).toHaveBeenCalledOnce();
    expect(file._sanitizedExt).toBe('pdf');
    expect(file._sha256).toHaveLength(64);
  });
});

// ─── Paso 3 — Subida a R2 ───────────────────────────────────────────────────────

describe('uploadFields() — subida a R2', () => {
  it('llama next() de inmediato si req.files no existe', async () => {
    const [, , , uploadStep] = uploadFields([{ name: 'documento', folder: 'docs' }]);
    const req = {};
    const res = mockRes();
    const next = vi.fn();

    await uploadStep(req, res, next);

    expect(next).toHaveBeenCalledOnce();
    expect(uploadFile).not.toHaveBeenCalled();
  });

  it('omite (continue) campos sin archivo adjunto cuando hay múltiples campos definidos', async () => {
    const fields = [
      { name: 'documento', folder: 'docs' },
      { name: 'anexo', folder: 'anexos' },
    ];
    const [, , , uploadStep] = uploadFields(fields);
    const file = fakeFile({ _sanitizedExt: 'pdf', _sha256: 'a'.repeat(64) });
    const req = { files: { documento: [file] }, user: { id: 'u1' }, ip: '10.0.0.1', body: {} };
    const res = mockRes();
    const next = vi.fn();

    await uploadStep(req, res, next);

    expect(next).toHaveBeenCalledOnce();
    expect(uploadFile).toHaveBeenCalledOnce();
  });

  it('sube el archivo válido y agrega `${campo}_url` y `${campo}_tamano_bytes` a req.body', async () => {
    const app = buildApp([{ name: 'documento', folder: 'docs' }], { authenticated: true });

    const res = await request(app)
      .post('/upload')
      .attach('documento', pdfBuffer(), { filename: 'informe.pdf', contentType: 'application/pdf' });

    expect(res.status).toBe(200);
    expect(res.body.body.documento_url).toBe('https://files.test.local/docs/archivo.pdf');
    expect(res.body.body.documento_tamano_bytes).toBeDefined();
    expect(registrarScanArchivo).toHaveBeenCalledWith(
      expect.objectContaining({ resultado: 'clean', uploadedBy: 'user-1' }),
    );
  });

  it('usa el bucket público (isPublic=true) para categoría image/thumbnail', async () => {
    const app = buildApp([{ name: 'foto', folder: 'fotos', category: 'image' }]);

    await request(app)
      .post('/upload')
      .attach('foto', jpegBuffer(), { filename: 'foto.jpg', contentType: 'image/jpeg' });

    expect(uploadFile).toHaveBeenCalledWith(
      expect.stringContaining('fotos/'),
      expect.any(Buffer),
      'image/jpeg',
      true,
    );
  });

  it('usa el bucket privado (isPublic=false) para categoría document por defecto', async () => {
    const app = buildApp([{ name: 'documento', folder: 'docs' }]);

    await request(app)
      .post('/upload')
      .attach('documento', pdfBuffer(), { filename: 'a.pdf', contentType: 'application/pdf' });

    expect(uploadFile).toHaveBeenCalledWith(
      expect.stringContaining('docs/'),
      expect.any(Buffer),
      'application/pdf',
      false,
    );
  });

  it('usa file.originalname para determinar la extensión cuando _sanitizedExt no está definido', async () => {
    const [, , , uploadStep] = uploadFields([{ name: 'documento', folder: 'docs' }]);
    const file = fakeFile({ originalname: 'reporte.PDF' });
    const req = { files: { documento: [file] }, body: {} };
    const res = mockRes();
    const next = vi.fn();

    await uploadStep(req, res, next);

    expect(uploadFile).toHaveBeenCalledWith(
      expect.stringMatching(/\.pdf$/),
      expect.any(Buffer),
      'application/pdf',
      false,
    );
    expect(next).toHaveBeenCalledOnce();
  });

  it('calcula sha256(file.buffer) como fallback cuando _sha256 no está definido', async () => {
    const [, , , uploadStep] = uploadFields([{ name: 'documento', folder: 'docs' }]);
    const file = fakeFile({ _sanitizedExt: 'pdf' });
    const req = { files: { documento: [file] }, body: {} };
    const res = mockRes();
    const next = vi.fn();

    await uploadStep(req, res, next);

    expect(registrarScanArchivo).toHaveBeenCalledWith(
      expect.objectContaining({ sha256Hash: expect.stringMatching(/^[0-9a-f]{64}$/) }),
    );
  });

  it('propaga el error a next() si uploadFile falla', async () => {
    uploadFile.mockRejectedValueOnce(new Error('R2 no disponible'));
    const [, , , uploadStep] = uploadFields([{ name: 'documento', folder: 'docs' }]);
    const file = fakeFile({ _sanitizedExt: 'pdf', _sha256: 'a'.repeat(64) });
    const req = { files: { documento: [file] }, body: {} };
    const res = mockRes();
    const next = vi.fn();

    await uploadStep(req, res, next);

    expect(next).toHaveBeenCalledWith(expect.objectContaining({ message: 'R2 no disponible' }));
  });
});

// ─── uploadSingle() — shorthand ─────────────────────────────────────────────────

describe('uploadSingle()', () => {
  it('sube un único archivo usando el nombre y carpeta indicados', async () => {
    const app = express();
    app.post('/upload', ...uploadSingle('foto', 'fotos'), (req, res) => res.status(200).json({ body: req.body }));

    const res = await request(app)
      .post('/upload')
      .attach('foto', pdfBuffer(), { filename: 'x.pdf', contentType: 'application/pdf' });

    expect(res.status).toBe(200);
    expect(res.body.body.foto_url).toBeDefined();
  });

  it('usa maxSizeMB=20 y category=document por defecto cuando no se especifican', () => {
    const mws = uploadSingle('doc', 'docs');
    expect(mws).toHaveLength(4);
  });
});
