import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../src/config/r2.js', () => ({
  extractKey:    vi.fn((url) => (url ? url.replace('https://private.r2.local/', '') : null)),
  getFileStream: vi.fn(),
}));

import { extractKey, getFileStream } from '../src/config/r2.js';
import { streamPrivateFile } from '../src/utils/streamFile.js';

function mockRes() {
  return {
    status: vi.fn().mockReturnThis(),
    json: vi.fn(),
    setHeader: vi.fn(),
    headersSent: false,
    destroy: vi.fn(),
  };
}

describe('streamPrivateFile', () => {
  const next = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    getFileStream.mockResolvedValue({
      stream: { pipe: vi.fn(), on: vi.fn() },
      contentType: 'application/pdf',
      contentLength: 2048,
    });
  });

  it('agrega Cache-Control privado y de corta duración -- nunca un caché compartido/CDN', async () => {
    const res = mockRes();
    await streamPrivateFile(res, next, 'https://private.r2.local/documentos/x.pdf', 'x.pdf');
    expect(res.setHeader).toHaveBeenCalledWith('Cache-Control', 'private, max-age=300');
  });

  it('sigue enviando Content-Type, Content-Length y Content-Disposition como antes', async () => {
    const res = mockRes();
    await streamPrivateFile(res, next, 'https://private.r2.local/documentos/x.pdf', 'x.pdf');
    expect(res.setHeader).toHaveBeenCalledWith('Content-Type', 'application/pdf');
    expect(res.setHeader).toHaveBeenCalledWith('Content-Length', '2048');
    expect(res.setHeader).toHaveBeenCalledWith('Content-Disposition', 'inline; filename="x.pdf"');
  });

  it('no agrega Cache-Control (ni ningún otro header) si la clave no se puede resolver', async () => {
    extractKey.mockReturnValueOnce(null);
    const res = mockRes();
    await streamPrivateFile(res, next, 'url-invalida', 'x.pdf');
    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.setHeader).not.toHaveBeenCalled();
  });
});
