/**
 * Tests directos para las funciones nuevas del solicitudes.controller.js
 * (show, listArchivos, uploadArchivo, deleteArchivo, downloadArchivo)
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../src/modules/solicitudes/solicitudes.service.js', () => ({
  getAll: vi.fn(), getMine: vi.fn(), create: vi.fn(), updateEstado: vi.fn(),
  responder: vi.fn(),
  getById:               vi.fn(),
  getArchivos:           vi.fn(),
  addArchivo:            vi.fn(),
  removeArchivo:         vi.fn(),
  getArchivoPresignedUrl: vi.fn(),
}));
vi.mock('../src/config/database.js', () => ({ query: vi.fn(), getClient: vi.fn() }));
vi.mock('../src/config/r2.js', () => ({
  uploadFile: vi.fn().mockResolvedValue('https://files.test.local/x.pdf'),
  extractKey: vi.fn(), isPublicUrl: vi.fn(), getPresignedUrl: vi.fn(), deleteFile: vi.fn(),
}));
vi.mock('../src/utils/auditLog.js', () => ({ registrarAuditoria: vi.fn() }));
vi.mock('../src/utils/mailer.js', () => ({
  notifySolicitudEstado: vi.fn(), notifyAdminNuevaSolicitud: vi.fn(), notifySolicitudRespuesta: vi.fn(),
}));
vi.mock('../src/modules/admin/admin.service.js', () => ({ getAdminEmails: vi.fn().mockResolvedValue([]) }));

import * as solService from '../src/modules/solicitudes/solicitudes.service.js';
import {
  show, listArchivos, uploadArchivo, deleteArchivo, downloadArchivo,
} from '../src/modules/solicitudes/solicitudes.controller.js';

const mockNext = vi.fn();
const ADMIN = { id: 'uuid-admin', email: 'admin@iiap.org.co', rol: 'admin_sig' };
const USER  = { id: 'uuid-user',  email: 'user@iiap.org.co',  rol: 'investigador' };

function res() {
  return { status: vi.fn().mockReturnThis(), json: vi.fn(), end: vi.fn() };
}

const SOL = { id: 'uuid-sol-1', tipo: 'agua', descripcion: 'test', estado: 'pendiente' };

describe('show()', () => {
  beforeEach(() => vi.clearAllMocks());

  it('retorna la solicitud por id', async () => {
    solService.getById.mockResolvedValue(SOL);
    const r = res();
    await show({ params: { id: SOL.id }, user: USER }, r, mockNext);
    expect(solService.getById).toHaveBeenCalledWith(SOL.id, USER.id, USER.rol);
    expect(r.json).toHaveBeenCalledWith(SOL);
  });

  it('llama next(err) si el servicio lanza', async () => {
    solService.getById.mockRejectedValue(Object.assign(new Error('no found'), { status: 404 }));
    await show({ params: { id: 'no' }, user: USER }, res(), mockNext);
    expect(mockNext).toHaveBeenCalledWith(expect.any(Error));
  });
});

describe('listArchivos()', () => {
  beforeEach(() => vi.clearAllMocks());

  it('retorna lista de archivos de la solicitud', async () => {
    const archivos = [{ id: 'uuid-arch-1', nombre: 'doc.pdf' }];
    solService.getArchivos.mockResolvedValue(archivos);
    const r = res();
    await listArchivos({ params: { id: SOL.id } }, r, mockNext);
    expect(r.json).toHaveBeenCalledWith(archivos);
  });

  it('llama next(err) si el servicio lanza', async () => {
    solService.getArchivos.mockRejectedValue(new Error('db error'));
    await listArchivos({ params: { id: SOL.id } }, res(), mockNext);
    expect(mockNext).toHaveBeenCalledWith(expect.any(Error));
  });
});

describe('uploadArchivo()', () => {
  beforeEach(() => vi.clearAllMocks());

  it('retorna 400 si no hay archivo_url en el body', async () => {
    const r = res();
    await uploadArchivo({ params: { id: SOL.id }, body: {}, user: USER }, r, mockNext);
    expect(r.status).toHaveBeenCalledWith(400);
    expect(r.json).toHaveBeenCalledWith(expect.objectContaining({ error: expect.any(String) }));
  });

  it('crea el registro del archivo y retorna 201', async () => {
    const archivo = { id: 'uuid-arch-1', nombre: 'doc.pdf', tamano_bytes: 1024 };
    solService.addArchivo.mockResolvedValue(archivo);
    const r = res();
    await uploadArchivo({
      params: { id: SOL.id },
      body: { archivo_url: 'https://files.test.local/doc.pdf', nombre: 'doc.pdf', archivo_tamano_bytes: '1024' },
      user: USER,
    }, r, mockNext);
    expect(r.status).toHaveBeenCalledWith(201);
    expect(r.json).toHaveBeenCalledWith(archivo);
  });

  it('llama next(err) si addArchivo lanza', async () => {
    solService.addArchivo.mockRejectedValue(new Error('db error'));
    await uploadArchivo({
      params: { id: SOL.id },
      body: { archivo_url: 'https://files.test.local/x.pdf' },
      user: USER,
    }, res(), mockNext);
    expect(mockNext).toHaveBeenCalledWith(expect.any(Error));
  });
});

describe('deleteArchivo()', () => {
  beforeEach(() => vi.clearAllMocks());

  it('elimina el archivo y responde 204', async () => {
    solService.removeArchivo.mockResolvedValue(undefined);
    const r = res();
    await deleteArchivo({ params: { id: SOL.id, archivoId: 'uuid-arch-1' } }, r, mockNext);
    expect(r.status).toHaveBeenCalledWith(204);
    expect(r.end).toHaveBeenCalled();
  });

  it('llama next(err) si removeArchivo lanza', async () => {
    solService.removeArchivo.mockRejectedValue(Object.assign(new Error('not found'), { status: 404 }));
    await deleteArchivo({ params: { id: SOL.id, archivoId: 'no' } }, res(), mockNext);
    expect(mockNext).toHaveBeenCalledWith(expect.any(Error));
  });
});

describe('downloadArchivo()', () => {
  beforeEach(() => vi.clearAllMocks());

  it('retorna la URL de descarga', async () => {
    solService.getArchivoPresignedUrl.mockResolvedValue({ url: 'https://presigned.test.local/doc.pdf' });
    const r = res();
    await downloadArchivo({ params: { id: SOL.id, archivoId: 'uuid-arch-1' } }, r, mockNext);
    expect(r.json).toHaveBeenCalledWith({ url: 'https://presigned.test.local/doc.pdf' });
  });

  it('llama next(err) si getArchivoPresignedUrl lanza', async () => {
    solService.getArchivoPresignedUrl.mockRejectedValue(new Error('not found'));
    await downloadArchivo({ params: { id: SOL.id, archivoId: 'no' } }, res(), mockNext);
    expect(mockNext).toHaveBeenCalledWith(expect.any(Error));
  });
});
