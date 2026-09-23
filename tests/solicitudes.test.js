import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { Readable } from 'node:stream';
import app from '../src/app.js';

vi.mock('../src/modules/solicitudes/solicitudes.service.js', () => ({
  getAll:         vi.fn(),
  getMine:        vi.fn(),
  getById:        vi.fn(),
  create:         vi.fn(),
  updateEstado:   vi.fn(),
  responder:      vi.fn(),
  addArchivo:     vi.fn(),
  getArchivos:    vi.fn(),
  getArchivoInfo: vi.fn(),
  removeArchivo:  vi.fn(),
}));

// query() aquí sirve dos dueños: requireModulo (permisos por módulo) y el
// propio controller (notificaciones de store/responder, ver solicitudes.controller.js).
// Se distingue por SQL para no alterar el comportamiento existente de esos paths.
vi.mock('../src/config/database.js', () => ({
  query: vi.fn((sql) =>
    /admin_permisos_modulo/.test(sql)
      ? Promise.resolve({ rows: [{ puede_ver: true, puede_editar: true }] })
      : Promise.resolve({ rows: [] })
  ),
  getClient: vi.fn(),
}));

vi.mock('../src/config/r2.js', () => ({
  uploadFile:  vi.fn().mockResolvedValue('https://files.test.local/solicitudes/archivo.pdf'),
  deleteFile:  vi.fn(),
  extractKey:  vi.fn((url) => url?.split('/').pop() ?? null),
  isPublicUrl: vi.fn(() => true),
  // streamPrivateFile() reenvía esto al cliente -- un Readable real para que
  // el test de integración (supertest, HTTP de verdad) reciba una respuesta
  // completa en vez de colgarse esperando datos que nunca llegan. Content-Length
  // debe coincidir exacto con los bytes reales -- si no, Node corta la conexión
  // ("aborted") en vez de completar la respuesta.
  getFileStream: vi.fn(() => {
    const body = Buffer.from('contenido de prueba');
    return Promise.resolve({
      stream: Readable.from(body),
      contentType: 'application/pdf',
      contentLength: body.byteLength,
    });
  }),
}));

import * as solService from '../src/modules/solicitudes/solicitudes.service.js';

const adminToken = jwt.sign(
  { id: 'uuid-admin', email: 'admin@iiap.org.co', rol: 'admin_sig' },
  process.env.JWT_SECRET,
);
const pubToken = jwt.sign(
  { id: 'uuid-pub', email: 'pub@iiap.org.co', rol: 'publico' },
  process.env.JWT_SECRET,
);
const invToken = jwt.sign(
  { id: 'uuid-inv', email: 'inv@iiap.org.co', rol: 'investigador' },
  process.env.JWT_SECRET,
);

const SOL_FIXTURE = {
  id: 'uuid-sol-1', tipo: 'Acceso a datos',
  descripcion: 'Solicito acceso a datos de biodiversidad',
  estado: 'pendiente', creado_en: new Date().toISOString(),
};

describe('GET /api/solicitudes (admin)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('retorna 401 sin token', async () => {
    const res = await request(app).get('/api/solicitudes');
    expect(res.status).toBe(401);
  });

  it('retorna 403 con rol publico', async () => {
    const res = await request(app)
      .get('/api/solicitudes')
      .set('Authorization', `Bearer ${pubToken}`);
    expect(res.status).toBe(403);
  });

  it('admin obtiene lista paginada', async () => {
    solService.getAll.mockResolvedValue({
      data: [SOL_FIXTURE],
      meta: { total: 1, page: 1 },
    });
    const res = await request(app)
      .get('/api/solicitudes')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
  });
});

describe('GET /api/solicitudes/mis-solicitudes', () => {
  beforeEach(() => vi.clearAllMocks());

  it('retorna 401 sin token', async () => {
    const res = await request(app).get('/api/solicitudes/mis-solicitudes');
    expect(res.status).toBe(401);
  });

  it('usuario autenticado ve sus solicitudes', async () => {
    solService.getMine.mockResolvedValue({
      data: [SOL_FIXTURE],
      meta: { total: 1 },
    });
    const res = await request(app)
      .get('/api/solicitudes/mis-solicitudes')
      .set('Authorization', `Bearer ${invToken}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
  });
});

describe('POST /api/solicitudes', () => {
  beforeEach(() => vi.clearAllMocks());

  it('retorna 401 sin token', async () => {
    const res = await request(app).post('/api/solicitudes').send({});
    expect(res.status).toBe(401);
  });

  // El rol 'publico' ya puede llegar al controlador (autorizado a nivel de ruta) —
  // el bloqueo/permiso real ahora depende de configuracion.publicoCanSolicitar,
  // evaluado dentro de solicitudes.service.js#create (ver solicitudes.service.test.js
  // para la cobertura completa de esa lógica con mocks de `query`).
  it('retorna 403 si el rol es publico y el toggle publicoCanSolicitar está deshabilitado', async () => {
    solService.create.mockRejectedValue(
      Object.assign(new Error('Los usuarios con rol Público no tienen habilitado el envío de solicitudes. Contacta a un administrador.'), { status: 403 })
    );
    const res = await request(app)
      .post('/api/solicitudes')
      .set('Authorization', `Bearer ${pubToken}`)
      .send({ tipo: 'uso-suelo', descripcion: 'Solicito acceso a datos de biodiversidad' });
    expect(res.status).toBe(403);
  });

  it('rol publico crea solicitud — retorna 201 cuando el toggle publicoCanSolicitar está habilitado', async () => {
    solService.create.mockResolvedValue(SOL_FIXTURE);
    const res = await request(app)
      .post('/api/solicitudes')
      .set('Authorization', `Bearer ${pubToken}`)
      .send({ tipo: 'uso-suelo', descripcion: 'Solicito acceso a datos de biodiversidad' });
    expect(res.status).toBe(201);
  });

  it('retorna 422 si falta el tipo (investigador)', async () => {
    const res = await request(app)
      .post('/api/solicitudes')
      .set('Authorization', `Bearer ${invToken}`)
      .send({ descripcion: 'Sin tipo' });
    expect(res.status).toBe(422);
  });

  it('investigador crea solicitud — retorna 201', async () => {
    solService.create.mockResolvedValue(SOL_FIXTURE);
    const res = await request(app)
      .post('/api/solicitudes')
      .set('Authorization', `Bearer ${invToken}`)
      .send({ tipo: 'uso-suelo', descripcion: 'Solicito acceso a datos de biodiversidad' });
    expect(res.status).toBe(201);
  });
});

describe('PATCH /api/solicitudes/:id/estado', () => {
  beforeEach(() => vi.clearAllMocks());

  it('retorna 401 sin token', async () => {
    const res = await request(app)
      .patch('/api/solicitudes/uuid-sol-1/estado')
      .send({ estado: 'aprobada' });
    expect(res.status).toBe(401);
  });

  it('retorna 403 con rol publico', async () => {
    const res = await request(app)
      .patch('/api/solicitudes/uuid-sol-1/estado')
      .set('Authorization', `Bearer ${pubToken}`)
      .send({ estado: 'aprobada' });
    expect(res.status).toBe(403);
  });

  it('admin aprueba solicitud — retorna 200', async () => {
    solService.updateEstado.mockResolvedValue({ ...SOL_FIXTURE, estado: 'aprobada' });
    const res = await request(app)
      .patch('/api/solicitudes/uuid-sol-1/estado')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ estado: 'aprobada' });
    expect(res.status).toBe(200);
    expect(res.body.estado).toBe('aprobada');
  });

  it('admin rechaza solicitud — retorna 200', async () => {
    solService.updateEstado.mockResolvedValue({ ...SOL_FIXTURE, estado: 'rechazada' });
    const res = await request(app)
      .patch('/api/solicitudes/uuid-sol-1/estado')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ estado: 'rechazada', nota: 'Información incompleta' });
    expect(res.status).toBe(200);
    expect(res.body.estado).toBe('rechazada');
  });

  it('admin marca en revisión — retorna 200', async () => {
    solService.updateEstado.mockResolvedValue({ ...SOL_FIXTURE, estado: 'en_revision' });
    const res = await request(app)
      .patch('/api/solicitudes/uuid-sol-1/estado')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ estado: 'en_revision' });
    expect(res.status).toBe(200);
    expect(res.body.estado).toBe('en_revision');
  });

  it('retorna 422 con estado inválido', async () => {
    const res = await request(app)
      .patch('/api/solicitudes/uuid-sol-1/estado')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ estado: 'estado_inventado' });
    expect(res.status).toBe(422);
  });
});

describe('POST /api/solicitudes/:id/responder', () => {
  beforeEach(() => vi.clearAllMocks());

  it('retorna 401 sin token', async () => {
    const res = await request(app)
      .post('/api/solicitudes/uuid-sol-1/responder')
      .send({ respuesta: 'texto' });
    expect(res.status).toBe(401);
  });

  it('retorna 403 con rol publico', async () => {
    const res = await request(app)
      .post('/api/solicitudes/uuid-sol-1/responder')
      .set('Authorization', `Bearer ${pubToken}`)
      .send({ respuesta: 'texto' });
    expect(res.status).toBe(403);
  });

  it('admin resuelve solicitud — retorna 200', async () => {
    const { responder } = await import('../src/modules/solicitudes/solicitudes.service.js');
    responder.mockResolvedValue({ ...SOL_FIXTURE, estado: 'resuelta', nota_admin: 'Aprobado' });
    const res = await request(app)
      .post('/api/solicitudes/uuid-sol-1/responder')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ respuesta: 'Su solicitud ha sido procesada favorablemente' });
    expect(res.status).toBe(200);
    expect(res.body.estado).toBe('resuelta');
  });

  it('retorna 422 si falta la respuesta', async () => {
    const res = await request(app)
      .post('/api/solicitudes/uuid-sol-1/responder')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({});
    expect(res.status).toBe(422);
  });
});

describe('POST /api/solicitudes/:id/archivos', () => {
  beforeEach(() => vi.clearAllMocks());

  it('retorna 401 sin token', async () => {
    const res = await request(app)
      .post('/api/solicitudes/uuid-sol-1/archivos');
    expect(res.status).toBe(401);
  });

  it('retorna 400 sin archivo', async () => {
    const res = await request(app)
      .post('/api/solicitudes/uuid-sol-1/archivos')
      .set('Authorization', `Bearer ${invToken}`);
    expect(res.status).toBe(400);
  });

  it('usuario sube archivo adjunto — retorna 201', async () => {
    const { addArchivo } = await import('../src/modules/solicitudes/solicitudes.service.js');
    addArchivo.mockResolvedValue({
      id: 'uuid-archivo-1', nombre: 'documento.pdf',
      mime_type: 'application/pdf', tamano_bytes: 1024,
      creado_en: new Date().toISOString(),
    });
    const res = await request(app)
      .post('/api/solicitudes/uuid-sol-1/archivos')
      .set('Authorization', `Bearer ${invToken}`)
      .attach('archivo', Buffer.from('%PDF-1.4 fake'), 'documento.pdf');
    expect(res.status).toBe(201);
    expect(res.body.nombre).toBe('documento.pdf');
  });
});

describe('GET /api/solicitudes/:id/archivos', () => {
  beforeEach(() => vi.clearAllMocks());

  it('retorna 401 sin token', async () => {
    const res = await request(app).get('/api/solicitudes/uuid-sol-1/archivos');
    expect(res.status).toBe(401);
  });

  it('usuario ve archivos de su solicitud — retorna 200', async () => {
    const { getArchivos } = await import('../src/modules/solicitudes/solicitudes.service.js');
    getArchivos.mockResolvedValue([
      { id: 'uuid-archivo-1', nombre: 'doc.pdf', mime_type: 'application/pdf', tamano_bytes: 1024 },
    ]);
    const res = await request(app)
      .get('/api/solicitudes/uuid-sol-1/archivos')
      .set('Authorization', `Bearer ${invToken}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });
});

describe('GET /api/solicitudes/:id/archivos/:archivoId/download', () => {
  beforeEach(() => vi.clearAllMocks());

  it('retorna 401 sin token', async () => {
    const res = await request(app)
      .get('/api/solicitudes/uuid-sol-1/archivos/uuid-archivo-1/download');
    expect(res.status).toBe(401);
  });

  it('reenvía el archivo directamente -- retorna 200 sin exponer una URL prefirmada', async () => {
    const { getArchivoInfo } = await import('../src/modules/solicitudes/solicitudes.service.js');
    getArchivoInfo.mockResolvedValue({
      url: 'https://files.test.local/solicitudes/doc.pdf', nombre: 'doc.pdf',
    });
    const res = await request(app)
      .get('/api/solicitudes/uuid-sol-1/archivos/uuid-archivo-1/download')
      .set('Authorization', `Bearer ${invToken}`);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('application/pdf');
    expect(Buffer.isBuffer(res.body) ? res.body.toString() : res.text).toBe('contenido de prueba');
  });
});

describe('DELETE /api/solicitudes/:id/archivos/:archivoId', () => {
  beforeEach(() => vi.clearAllMocks());

  it('retorna 401 sin token', async () => {
    const res = await request(app)
      .delete('/api/solicitudes/uuid-sol-1/archivos/uuid-archivo-1');
    expect(res.status).toBe(401);
  });

  it('retorna 403 con rol publico', async () => {
    const res = await request(app)
      .delete('/api/solicitudes/uuid-sol-1/archivos/uuid-archivo-1')
      .set('Authorization', `Bearer ${pubToken}`);
    expect(res.status).toBe(403);
  });

  it('admin elimina archivo — retorna 204', async () => {
    const { removeArchivo } = await import('../src/modules/solicitudes/solicitudes.service.js');
    removeArchivo.mockResolvedValue(undefined);
    const res = await request(app)
      .delete('/api/solicitudes/uuid-sol-1/archivos/uuid-archivo-1')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(204);
  });
});
