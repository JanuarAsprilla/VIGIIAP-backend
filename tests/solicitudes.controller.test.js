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
vi.mock('../src/config/database.js', () => ({ query: vi.fn().mockResolvedValue({ rows: [] }), getClient: vi.fn() }));
vi.mock('../src/config/r2.js', () => ({
  uploadFile: vi.fn(), extractKey: vi.fn(), isPublicUrl: vi.fn(),
  getPresignedUrl: vi.fn(), deleteFile: vi.fn(), deleteFileByUrl: vi.fn(),
}));
vi.mock('../src/utils/auditLog.js', () => ({ registrarAuditoria: vi.fn() }));
vi.mock('../src/utils/mailer.js', () => ({
  notifySolicitudEstado:     vi.fn().mockResolvedValue(undefined),
  notifyAdminNuevaSolicitud: vi.fn().mockResolvedValue(undefined),
  notifySolicitudRespuesta:  vi.fn().mockResolvedValue(undefined),
  notifySolicitudRecibida:   vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../src/utils/dataCustody.js', () => ({
  registrarScanArchivo: vi.fn().mockResolvedValue(undefined),
  registrarCustodia: vi.fn(), registrarDescarga: vi.fn(), ACCION: {},
}));
vi.mock('../src/middlewares/fileGuard.js', () => ({
  validateFile: vi.fn().mockReturnValue({ valid: true, sanitizedExt: 'pdf', hash: 'abc' }),
  sha256: vi.fn().mockReturnValue('abc123'),
}));
vi.mock('../src/modules/admin/admin.service.js', () => ({
  getAdminEmails: vi.fn().mockResolvedValue([]),
}));
vi.mock('../src/utils/logger.js', () => ({
  default: { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() },
}));

import * as solService from '../src/modules/solicitudes/solicitudes.service.js';
import { query } from '../src/config/database.js';
import { notifySolicitudEstado, notifySolicitudRecibida, notifyAdminNuevaSolicitud, notifySolicitudRespuesta } from '../src/utils/mailer.js';
import { getAdminEmails } from '../src/modules/admin/admin.service.js';
import logger from '../src/utils/logger.js';
import {
  show, getArchivos, uploadArchivo, deleteArchivo, downloadArchivo,
  updateEstado, responder, store,
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

  it('usuario normal pasa isAdmin=false', async () => {
    solService.getById.mockResolvedValue(SOL);
    const r = res();
    await show({ params: { id: SOL.id }, user: USER }, r, mockNext);
    expect(solService.getById).toHaveBeenCalledWith(SOL.id, USER.id, false);
    expect(r.json).toHaveBeenCalledWith(SOL);
  });

  it('admin pasa isAdmin=true', async () => {
    solService.getById.mockResolvedValue(SOL);
    await show({ params: { id: SOL.id }, user: ADMIN }, res(), mockNext);
    expect(solService.getById).toHaveBeenCalledWith(SOL.id, ADMIN.id, true);
  });

  it('llama next(err) si el servicio lanza', async () => {
    solService.getById.mockRejectedValue(Object.assign(new Error('no found'), { status: 404 }));
    await show({ params: { id: 'no' }, user: USER }, res(), mockNext);
    expect(mockNext).toHaveBeenCalledWith(expect.any(Error));
  });
});

describe('getArchivos()', () => {
  beforeEach(() => vi.clearAllMocks());

  it('retorna lista de archivos', async () => {
    solService.getArchivos.mockResolvedValue([{ id: 'a1' }]);
    const r = res();
    await getArchivos({ params: { id: SOL.id }, user: USER }, r, mockNext);
    expect(solService.getArchivos).toHaveBeenCalledWith(SOL.id, USER.id, false);
    expect(r.json).toHaveBeenCalled();
  });

  it('llama next(err) si el servicio lanza', async () => {
    solService.getArchivos.mockRejectedValue(new Error('db'));
    await getArchivos({ params: { id: SOL.id }, user: USER }, res(), mockNext);
    expect(mockNext).toHaveBeenCalledWith(expect.any(Error));
  });
});

describe('uploadArchivo()', () => {
  beforeEach(() => vi.clearAllMocks());

  it('retorna 400 si no hay req.file', async () => {
    const r = res();
    await uploadArchivo({ params: { id: SOL.id }, file: undefined, user: USER, ip: '::1' }, r, mockNext);
    expect(r.status).toHaveBeenCalledWith(400);
  });

  it('crea el archivo y retorna 201', async () => {
    solService.addArchivo.mockResolvedValue({ id: 'a1', nombre: 'doc.pdf' });
    const r = res();
    await uploadArchivo({
      params: { id: SOL.id },
      file: { originalname: 'doc.pdf', mimetype: 'application/pdf', buffer: Buffer.from('x'), size: 1 },
      user: USER, ip: '::1',
    }, r, mockNext);
    expect(r.status).toHaveBeenCalledWith(201);
  });

  it('llama next(err) si el servicio lanza', async () => {
    solService.addArchivo.mockRejectedValue(new Error('err'));
    await uploadArchivo({
      params: { id: SOL.id },
      file: { originalname: 'f.pdf', mimetype: 'application/pdf', buffer: Buffer.from('x'), size: 1 },
      user: USER, ip: '::1',
    }, res(), mockNext);
    expect(mockNext).toHaveBeenCalledWith(expect.any(Error));
  });
});

describe('deleteArchivo()', () => {
  beforeEach(() => vi.clearAllMocks());

  it('elimina el archivo y responde 204', async () => {
    solService.removeArchivo.mockResolvedValue(undefined);
    const r = res();
    await deleteArchivo({ params: { id: SOL.id, archivoId: 'a1' }, user: ADMIN }, r, mockNext);
    expect(solService.removeArchivo).toHaveBeenCalledWith(SOL.id, 'a1', ADMIN.id);
    expect(r.status).toHaveBeenCalledWith(204);
  });

  it('llama next(err) si removeArchivo lanza', async () => {
    solService.removeArchivo.mockRejectedValue(new Error('err'));
    await deleteArchivo({ params: { id: SOL.id, archivoId: 'no' }, user: ADMIN }, res(), mockNext);
    expect(mockNext).toHaveBeenCalledWith(expect.any(Error));
  });
});

describe('downloadArchivo()', () => {
  beforeEach(() => vi.clearAllMocks());

  it('retorna la URL de descarga', async () => {
    solService.getArchivoPresignedUrl.mockResolvedValue({ url: 'https://presigned.test/doc.pdf' });
    const r = res();
    await downloadArchivo({ params: { id: SOL.id, archivoId: 'a1' }, user: USER }, r, mockNext);
    expect(solService.getArchivoPresignedUrl).toHaveBeenCalledWith(SOL.id, 'a1', USER.id, false);
    expect(r.json).toHaveBeenCalledWith({ url: 'https://presigned.test/doc.pdf' });
  });

  it('llama next(err) si getArchivoPresignedUrl lanza', async () => {
    solService.getArchivoPresignedUrl.mockRejectedValue(new Error('err'));
    await downloadArchivo({ params: { id: SOL.id, archivoId: 'no' }, user: USER }, res(), mockNext);
    expect(mockNext).toHaveBeenCalledWith(expect.any(Error));
  });
});

describe('updateEstado()', () => {
  // El servicio ya devuelve owner_nombre/owner_email en la misma query (CTE)
  // El controller ya no hace SELECT extra — no hay query adicional que mockear
  beforeEach(() => {
    vi.clearAllMocks();
    solService.updateEstado.mockResolvedValue({
      ...SOL,
      owner_nombre: 'Ana',
      owner_email: 'ana@test.co',
    });
  });

  it('con owner encontrado envía email y responde json', async () => {
    const r = res();
    await updateEstado(
      { params: { id: SOL.id }, body: { estado: 'aprobada', nota: 'Solicitud aprobada correctamente' }, user: ADMIN, ip: '::1' },
      r, mockNext,
    );
    expect(r.json).toHaveBeenCalledWith(expect.objectContaining({ id: SOL.id }));
    expect(notifySolicitudEstado).toHaveBeenCalledWith(expect.objectContaining({ email: 'ana@test.co' }));
  });

  it('sin owner_email no intenta enviar email', async () => {
    solService.updateEstado.mockResolvedValue({ ...SOL, owner_email: null });
    const r = res();
    await updateEstado(
      { params: { id: SOL.id }, body: { estado: 'rechazada' }, user: ADMIN, ip: '::1' },
      r, mockNext,
    );
    expect(r.json).toHaveBeenCalledWith(expect.objectContaining({ id: SOL.id }));
    expect(notifySolicitudEstado).not.toHaveBeenCalled();
  });

  it('llama next(err) si el servicio lanza', async () => {
    solService.updateEstado.mockRejectedValue(new Error('err'));
    await updateEstado(
      { params: { id: SOL.id }, body: { estado: 'aprobada', nota: '' }, user: ADMIN, ip: '::1' },
      res(), mockNext,
    );
    expect(mockNext).toHaveBeenCalledWith(expect.any(Error));
  });

  it('registra el error si el envío de email de estado falla, sin interrumpir la respuesta', async () => {
    notifySolicitudEstado.mockRejectedValueOnce(new Error('smtp caído'));
    const r = res();
    await updateEstado(
      { params: { id: SOL.id }, body: { estado: 'aprobada', nota: 'Todo en orden' }, user: ADMIN, ip: '::1' },
      r, mockNext,
    );
    expect(r.json).toHaveBeenCalledWith(expect.objectContaining({ id: SOL.id }));
    await vi.waitFor(() => {
      expect(logger.error).toHaveBeenCalledWith(
        '[solicitudes] Email estado error:', expect.any(String),
      );
    });
  });
});

describe('responder()', () => {
  beforeEach(() => { vi.clearAllMocks(); solService.responder.mockResolvedValue(SOL); });

  it('con owner encontrado envía email de respuesta', async () => {
    query.mockResolvedValueOnce({ rows: [{ nombre: 'Carlos', email: 'carlos@test.co', tipo: 'flora' }] });
    const r = res();
    await responder(
      { params: { id: SOL.id }, body: { respuesta: 'Acceso concedido' }, user: ADMIN, ip: '::1' },
      r, mockNext,
    );
    expect(r.json).toHaveBeenCalledWith(SOL);
  });

  it('sin owner no envía email', async () => {
    query.mockResolvedValueOnce({ rows: [] });
    const r = res();
    await responder(
      { params: { id: SOL.id }, body: { respuesta: 'Acceso concedido' }, user: ADMIN, ip: '::1' },
      r, mockNext,
    );
    expect(r.json).toHaveBeenCalledWith(SOL);
  });

  it('llama next(err) si el servicio lanza', async () => {
    solService.responder.mockRejectedValue(new Error('err'));
    await responder(
      { params: { id: SOL.id }, body: { respuesta: 'texto' }, user: ADMIN, ip: '::1' },
      res(), mockNext,
    );
    expect(mockNext).toHaveBeenCalledWith(expect.any(Error));
  });

  it('registra el error si el envío de email de respuesta falla, sin interrumpir la respuesta', async () => {
    query.mockResolvedValueOnce({ rows: [{ nombre: 'Carlos', email: 'carlos@test.co', tipo: 'flora' }] });
    notifySolicitudRespuesta.mockRejectedValueOnce(new Error('smtp caído'));
    const r = res();
    await responder(
      { params: { id: SOL.id }, body: { respuesta: 'Acceso concedido' }, user: ADMIN, ip: '::1' },
      r, mockNext,
    );
    expect(r.json).toHaveBeenCalledWith(SOL);
    await vi.waitFor(() => {
      expect(logger.error).toHaveBeenCalledWith(
        '[solicitudes] Email respuesta error:', expect.any(String),
      );
    });
  });
});

describe('store()', () => {
  beforeEach(() => { vi.clearAllMocks(); solService.create.mockResolvedValue({ ...SOL, id: 'new-uuid' }); });

  it('con solicitante encontrado envía email y responde 201', async () => {
    query.mockResolvedValueOnce({ rows: [{ nombre: 'Juan', email: 'juan@test.co' }] });
    const r = res();
    await store({
      body: { tipo: 'uso-suelo', descripcion: 'Solicitud de prueba para el test' },
      user: USER, ip: '::1',
    }, r, mockNext);
    expect(r.status).toHaveBeenCalledWith(201);
  });

  it('sin solicitante no envía email pero responde 201', async () => {
    query.mockResolvedValueOnce({ rows: [] });
    const r = res();
    await store({
      body: { tipo: 'otro', descripcion: 'Otra solicitud de prueba suficiente' },
      user: USER, ip: '::1',
    }, r, mockNext);
    expect(r.status).toHaveBeenCalledWith(201);
  });

  it('llama next(err) si el servicio lanza', async () => {
    solService.create.mockRejectedValue(new Error('db error'));
    await store({
      body: { tipo: 'linderos', descripcion: 'Solicitud que va a fallar en BD' },
      user: USER, ip: '::1',
    }, res(), mockNext);
    expect(mockNext).toHaveBeenCalledWith(expect.any(Error));
  });

  it('registra el error si el email de confirmación al solicitante falla', async () => {
    query.mockResolvedValueOnce({ rows: [{ nombre: 'Juan', email: 'juan@test.co' }] });
    notifySolicitudRecibida.mockRejectedValueOnce(new Error('smtp caído'));
    const r = res();
    await store({
      body: { tipo: 'uso-suelo', descripcion: 'Solicitud de prueba para el test' },
      user: USER, ip: '::1',
    }, r, mockNext);
    expect(r.status).toHaveBeenCalledWith(201);
    await vi.waitFor(() => {
      expect(logger.error).toHaveBeenCalledWith(
        '[solicitudes] Email recibida error:', expect.any(String),
      );
    });
  });

  it('notifica a todos los admins cuando hay adminEmails registrados', async () => {
    query.mockResolvedValueOnce({ rows: [{ nombre: 'Juan', email: 'juan@test.co' }] });
    getAdminEmails.mockResolvedValueOnce(['admin1@iiap.co', 'admin2@iiap.co']);
    const r = res();
    await store({
      body: { tipo: 'uso-suelo', descripcion: 'Solicitud de prueba para el test' },
      user: USER, ip: '::1',
    }, r, mockNext);
    expect(r.status).toHaveBeenCalledWith(201);
    await vi.waitFor(() => {
      expect(notifyAdminNuevaSolicitud).toHaveBeenCalledTimes(2);
      expect(notifyAdminNuevaSolicitud).toHaveBeenCalledWith(
        expect.objectContaining({ adminEmail: 'admin1@iiap.co', solicitante: 'Juan' }),
      );
    });
  });

  it('registra el error si el envío a un admin individual falla', async () => {
    query.mockResolvedValueOnce({ rows: [{ nombre: 'Juan', email: 'juan@test.co' }] });
    getAdminEmails.mockResolvedValueOnce(['admin1@iiap.co']);
    notifyAdminNuevaSolicitud.mockRejectedValueOnce(new Error('smtp admin caído'));
    const r = res();
    await store({
      body: { tipo: 'uso-suelo', descripcion: 'Solicitud de prueba para el test' },
      user: USER, ip: '::1',
    }, r, mockNext);
    await vi.waitFor(() => {
      expect(logger.error).toHaveBeenCalledWith(
        '[solicitudes] Email admin error:', expect.any(String),
      );
    });
  });

  it('registra el error si getAdminEmails() falla', async () => {
    query.mockResolvedValueOnce({ rows: [{ nombre: 'Juan', email: 'juan@test.co' }] });
    getAdminEmails.mockRejectedValueOnce(new Error('db down'));
    const r = res();
    await store({
      body: { tipo: 'uso-suelo', descripcion: 'Solicitud de prueba para el test' },
      user: USER, ip: '::1',
    }, r, mockNext);
    await vi.waitFor(() => {
      expect(logger.error).toHaveBeenCalledWith(
        '[solicitudes] getAdminEmails error:', expect.any(String),
      );
    });
  });
});
