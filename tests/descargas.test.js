import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../src/config/database.js', () => ({
  query:     vi.fn().mockResolvedValue({ rows: [] }),
  getClient: vi.fn(),
}));

vi.mock('../src/config/r2.js', () => ({
  uploadFile:      vi.fn(),
  deleteFile:      vi.fn(),
  extractKey:      vi.fn((url) => (url ? url.replace('https://private.r2.local/', '') : null)),
  isPublicUrl:     vi.fn((url) => url?.startsWith('https://files.test.local')),
  getPresignedUrl: vi.fn().mockResolvedValue('https://presigned.r2.local/signed-url'),
}));

vi.mock('../src/utils/dataCustody.js', () => ({
  registrarDescarga:    vi.fn(),
  registrarCustodia:    vi.fn(),
  registrarScanArchivo: vi.fn(),
  ACCION:               { DESCARGA: 'descarga' },
}));

import { query } from '../src/config/database.js';
import { isPublicUrl, extractKey, getPresignedUrl } from '../src/config/r2.js';
import { descargarMapa, descargarDocumento } from '../src/modules/descargas/descargas.controller.js';

// ── Fixtures ───────────────────────────────────────────────────────────────

const MAPA_PUBLICO = {
  id: 'uuid-mapa-1',
  titulo: 'Mapa de Biodiversidad',
  activo: true,
  visibilidad: 'publico',
  archivo_pdf_url: 'https://files.test.local/mapas/bio.pdf',
  archivo_img_url: 'https://files.test.local/mapas/bio.jpg',
};

const MAPA_ACREDITADOS = {
  ...MAPA_PUBLICO,
  id: 'uuid-mapa-2',
  visibilidad: 'acreditados',
  archivo_pdf_url: 'https://private.r2.local/mapas/restricted.pdf',
};

const DOC_PUBLICO = {
  id: 'uuid-doc-1',
  titulo: 'Informe Biodiversidad',
  activo: true,
  visibilidad: 'publico',
  archivo_url: 'https://files.test.local/docs/informe.pdf',
};

// ── Helper: build mock req/res/next ───────────────────────────────────────

function mockReq(overrides = {}) {
  return {
    params: {},
    query: {},
    user: null,
    ip: '::1',
    ...overrides,
  };
}

function mockRes() {
  const res = {
    _location: null,
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
    redirect: vi.fn().mockReturnThis(),
  };
  return res;
}

const mockNext = vi.fn();

// ── descargarMapa() ────────────────────────────────────────────────────────

describe('descargarMapa()', () => {
  beforeEach(() => vi.clearAllMocks());

  it('retorna 404 cuando el mapa no existe', async () => {
    query.mockResolvedValueOnce({ rows: [] });
    const res = mockRes();
    await descargarMapa(mockReq({ params: { id: 'no-id' } }), res, mockNext);
    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ error: expect.stringMatching(/no encontrado/i) }));
  });

  it('retorna 404 cuando el mapa está inactivo', async () => {
    query.mockResolvedValueOnce({ rows: [{ ...MAPA_PUBLICO, activo: false }] });
    const res = mockRes();
    await descargarMapa(mockReq({ params: { id: 'uuid-mapa-1' } }), res, mockNext);
    expect(res.status).toHaveBeenCalledWith(404);
  });

  it('retorna 403 para mapa acreditados sin autenticación', async () => {
    query.mockResolvedValueOnce({ rows: [MAPA_ACREDITADOS] });
    const res = mockRes();
    await descargarMapa(mockReq({ params: { id: 'uuid-mapa-2' }, user: null }), res, mockNext);
    expect(res.status).toHaveBeenCalledWith(403);
  });

  it('retorna 403 para mapa acreditados con rol visitante', async () => {
    query.mockResolvedValueOnce({ rows: [MAPA_ACREDITADOS] });
    const res = mockRes();
    const req = mockReq({ params: { id: 'uuid-mapa-2' }, user: { rol: 'visitante' } });
    await descargarMapa(req, res, mockNext);
    expect(res.status).toHaveBeenCalledWith(403);
  });

  it('redirige a URL pública para mapa público', async () => {
    query.mockResolvedValueOnce({ rows: [MAPA_PUBLICO] });
    isPublicUrl.mockReturnValueOnce(true);
    const res = mockRes();
    await descargarMapa(mockReq({ params: { id: 'uuid-mapa-1' } }), res, mockNext);
    expect(res.redirect).toHaveBeenCalledWith(302, MAPA_PUBLICO.archivo_pdf_url);
  });

  it('genera URL prefirmada para mapa privado con admin', async () => {
    query.mockResolvedValueOnce({ rows: [MAPA_ACREDITADOS] });
    isPublicUrl.mockReturnValueOnce(false);
    extractKey.mockReturnValueOnce('mapas/restricted.pdf');
    const res = mockRes();
    const req = mockReq({ params: { id: 'uuid-mapa-2' }, user: { rol: 'admin_sig' } });
    await descargarMapa(req, res, mockNext);
    expect(getPresignedUrl).toHaveBeenCalledWith('mapas/restricted.pdf', 120);
    expect(res.redirect).toHaveBeenCalledWith(302, 'https://presigned.r2.local/signed-url');
  });

  it('sirve imagen cuando campo=archivo_img', async () => {
    query.mockResolvedValueOnce({ rows: [MAPA_PUBLICO] });
    isPublicUrl.mockReturnValueOnce(true);
    const res = mockRes();
    const req = mockReq({ params: { id: 'uuid-mapa-1' }, query: { campo: 'archivo_img' } });
    await descargarMapa(req, res, mockNext);
    expect(res.redirect).toHaveBeenCalledWith(302, MAPA_PUBLICO.archivo_img_url);
  });

  it('retorna 404 cuando archivo_pdf_url es null', async () => {
    query.mockResolvedValueOnce({ rows: [{ ...MAPA_PUBLICO, archivo_pdf_url: null }] });
    const res = mockRes();
    await descargarMapa(mockReq({ params: { id: 'uuid-mapa-1' } }), res, mockNext);
    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ error: expect.stringMatching(/no disponible/i) }));
  });

  it('retorna 500 cuando extractKey falla (null key)', async () => {
    query.mockResolvedValueOnce({ rows: [MAPA_ACREDITADOS] });
    isPublicUrl.mockReturnValueOnce(false);
    extractKey.mockReturnValueOnce(null);
    const res = mockRes();
    const req = mockReq({ params: { id: 'uuid-mapa-2' }, user: { rol: 'admin_sig' } });
    await descargarMapa(req, res, mockNext);
    expect(res.status).toHaveBeenCalledWith(500);
  });

  it('llama next(err) cuando query lanza', async () => {
    query.mockRejectedValueOnce(new Error('DB error'));
    const res = mockRes();
    await descargarMapa(mockReq({ params: { id: 'id' } }), res, mockNext);
    expect(mockNext).toHaveBeenCalledWith(expect.any(Error));
  });

  it('permite acceso a mapa visibilidad usuarios con rol investigador', async () => {
    const mapaUsuarios = { ...MAPA_PUBLICO, visibilidad: 'usuarios' };
    query.mockResolvedValueOnce({ rows: [mapaUsuarios] });
    isPublicUrl.mockReturnValueOnce(true);
    const res = mockRes();
    const req = mockReq({ params: { id: 'uuid-mapa-1' }, user: { rol: 'investigador' } });
    await descargarMapa(req, res, mockNext);
    expect(res.redirect).toHaveBeenCalledWith(302, mapaUsuarios.archivo_pdf_url);
  });
});

// ── descargarDocumento() ───────────────────────────────────────────────────

describe('descargarDocumento()', () => {
  beforeEach(() => vi.clearAllMocks());

  it('retorna 404 cuando el documento no existe', async () => {
    query.mockResolvedValueOnce({ rows: [] });
    const res = mockRes();
    await descargarDocumento(mockReq({ params: { id: 'no-id' } }), res, mockNext);
    expect(res.status).toHaveBeenCalledWith(404);
  });

  it('retorna 404 cuando el documento está inactivo', async () => {
    query.mockResolvedValueOnce({ rows: [{ ...DOC_PUBLICO, activo: false }] });
    const res = mockRes();
    await descargarDocumento(mockReq({ params: { id: 'uuid-doc-1' } }), res, mockNext);
    expect(res.status).toHaveBeenCalledWith(404);
  });

  it('retorna 403 para documento acreditados sin auth', async () => {
    query.mockResolvedValueOnce({ rows: [{ ...DOC_PUBLICO, visibilidad: 'acreditados' }] });
    const res = mockRes();
    await descargarDocumento(mockReq({ params: { id: 'uuid-doc-1' } }), res, mockNext);
    expect(res.status).toHaveBeenCalledWith(403);
  });

  it('redirige a URL pública para documento público', async () => {
    query.mockResolvedValueOnce({ rows: [DOC_PUBLICO] });
    isPublicUrl.mockReturnValueOnce(true);
    const res = mockRes();
    await descargarDocumento(mockReq({ params: { id: 'uuid-doc-1' } }), res, mockNext);
    expect(res.redirect).toHaveBeenCalledWith(302, DOC_PUBLICO.archivo_url);
  });

  it('genera URL prefirmada para documento privado con admin', async () => {
    const docPrivado = { ...DOC_PUBLICO, visibilidad: 'acreditados', archivo_url: 'https://private.r2.local/docs/private.pdf' };
    query.mockResolvedValueOnce({ rows: [docPrivado] });
    isPublicUrl.mockReturnValueOnce(false);
    extractKey.mockReturnValueOnce('docs/private.pdf');
    const res = mockRes();
    const req = mockReq({ params: { id: 'uuid-doc-1' }, user: { rol: 'admin_sig' } });
    await descargarDocumento(req, res, mockNext);
    expect(getPresignedUrl).toHaveBeenCalledWith('docs/private.pdf', 120);
    expect(res.redirect).toHaveBeenCalledWith(302, 'https://presigned.r2.local/signed-url');
  });

  it('retorna 404 cuando archivo_url es null', async () => {
    query.mockResolvedValueOnce({ rows: [{ ...DOC_PUBLICO, archivo_url: null }] });
    const res = mockRes();
    await descargarDocumento(mockReq({ params: { id: 'uuid-doc-1' } }), res, mockNext);
    expect(res.status).toHaveBeenCalledWith(404);
  });

  it('retorna 500 cuando extractKey retorna null', async () => {
    const docPrivado = { ...DOC_PUBLICO, visibilidad: 'acreditados', archivo_url: 'https://private.r2.local/docs/private.pdf' };
    query.mockResolvedValueOnce({ rows: [docPrivado] });
    isPublicUrl.mockReturnValueOnce(false);
    extractKey.mockReturnValueOnce(null);
    const res = mockRes();
    const req = mockReq({ params: { id: 'uuid-doc-1' }, user: { rol: 'admin_sig' } });
    await descargarDocumento(req, res, mockNext);
    expect(res.status).toHaveBeenCalledWith(500);
  });

  it('llama next(err) cuando query lanza', async () => {
    query.mockRejectedValueOnce(new Error('DB error'));
    const res = mockRes();
    await descargarDocumento(mockReq({ params: { id: 'id' } }), res, mockNext);
    expect(mockNext).toHaveBeenCalledWith(expect.any(Error));
  });
});
