import { Readable, Writable } from 'node:stream';
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
    on: vi.fn(),
  };
}

describe('streamPrivateFile', () => {
  const next = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    getFileStream.mockResolvedValue({
      stream: { pipe: vi.fn(), on: vi.fn(), destroy: vi.fn(), destroyed: false },
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

  it('si el cliente aborta (close en la respuesta) destruye el origen S3 para liberar el socket', async () => {
    const res = mockRes();
    const { stream } = await getFileStream();
    await streamPrivateFile(res, next, 'https://private.r2.local/documentos/x.pdf', 'x.pdf');
    const [evento, manejador] = res.on.mock.calls.find(([e]) => e === 'close');
    expect(evento).toBe('close');
    expect(stream.destroy).not.toHaveBeenCalled();
    manejador();
    expect(stream.destroy).toHaveBeenCalledTimes(1);
  });

  it('no vuelve a destruir un origen que ya terminó o se destruyó', async () => {
    const res = mockRes();
    const { stream } = await getFileStream();
    stream.destroyed = true;
    await streamPrivateFile(res, next, 'https://private.r2.local/documentos/x.pdf', 'x.pdf');
    res.on.mock.calls.find(([e]) => e === 'close')[1]();
    expect(stream.destroy).not.toHaveBeenCalled();
  });

  it('sigue reenviando el origen a la respuesta con pipe', async () => {
    const res = mockRes();
    const { stream } = await getFileStream();
    await streamPrivateFile(res, next, 'https://private.r2.local/documentos/x.pdf', 'x.pdf');
    expect(stream.pipe).toHaveBeenCalledWith(res);
  });

  it('con streams reales: abortar la respuesta destruye el Readable de origen', async () => {
    const origen = new Readable({ read() {} });
    getFileStream.mockResolvedValueOnce({ stream: origen, contentType: 'application/pdf', contentLength: 10 });
    const res = Object.assign(new Writable({ write(_c, _e, cb) { cb(); } }), { setHeader: vi.fn(), headersSent: false });
    await streamPrivateFile(res, next, 'https://private.r2.local/documentos/x.pdf', 'x.pdf');
    origen.push('datos');
    res.destroy();
    await new Promise((r) => { setImmediate(r); });
    expect(origen.destroyed).toBe(true);
  });
});

