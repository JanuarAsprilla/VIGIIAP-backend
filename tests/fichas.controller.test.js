import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

vi.mock('../src/modules/fichas/fichas.service.js', () => ({
  crearMedioImagen: vi.fn(),
  crearMedioVideo: vi.fn(),
}));
vi.mock('../src/utils/auditLog.js', () => ({ registrarAuditoria: vi.fn() }));

import * as fichasService from '../src/modules/fichas/fichas.service.js';
import { subirMedio } from '../src/modules/fichas/fichas.controller.js';

const existe = (ruta) => fsp.access(ruta).then(() => true, () => false);

function mockRes() {
  return { status: vi.fn().mockReturnThis(), json: vi.fn().mockReturnThis() };
}

describe('subirMedio() — temporales tras la subida', () => {
  let dir;
  let archivo;
  let poster;

  beforeEach(async () => {
    vi.clearAllMocks();
    dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'fichas-ctrl-'));
    archivo = path.join(dir, 'medio.bin');
    poster = path.join(dir, 'poster.jpg');
    await fsp.writeFile(archivo, 'x');
    await fsp.writeFile(poster, 'x');
  });

  afterEach(() => fsp.rm(dir, { recursive: true, force: true }));

  const peticion = (tipo, body = {}) => ({
    params: { configId: 'cfg', valor: 'v1' },
    body,
    user: { id: 'u1', email: 'u@iiap.test' },
    ip: '127.0.0.1',
    medioFicha: { tipo, path: archivo, posterPath: poster, bytes: 1 },
  });

  it('borra el archivo y el poster si los metadatos no son válidos', async () => {
    const next = vi.fn();
    await subirMedio(peticion('video', { leyenda: 'x'.repeat(5000) }), mockRes(), next);

    expect(next).toHaveBeenCalledWith(expect.anything());
    expect(fichasService.crearMedioVideo).not.toHaveBeenCalled();
    expect(await existe(archivo)).toBe(false);
    expect(await existe(poster)).toBe(false);
  });

  it('borra los temporales si el servicio falla después de la subida', async () => {
    fichasService.crearMedioImagen.mockRejectedValue(new Error('BD caída'));
    const next = vi.fn();
    await subirMedio(peticion('imagen'), mockRes(), next);

    expect(next).toHaveBeenCalledWith(expect.objectContaining({ message: 'BD caída' }));
    expect(await existe(archivo)).toBe(false);
    expect(await existe(poster)).toBe(false);
  });

  it('no toca los temporales del video cuando el servicio los recibió (los procesa en segundo plano)', async () => {
    fichasService.crearMedioVideo.mockResolvedValue({ id: 'm1' });
    const res = mockRes();
    await subirMedio(peticion('video'), res, vi.fn());

    expect(res.status).toHaveBeenCalledWith(201);
    expect(await existe(archivo)).toBe(true);
    expect(await existe(poster)).toBe(true);
  });
});
