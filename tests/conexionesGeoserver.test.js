import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';

vi.mock('../src/modules/geovisores/conexionesGeoserver.service.js', () => ({
  getAll:              vi.fn(),
  getById:             vi.fn(),
  create:              vi.fn(),
  update:              vi.fn(),
  remove:              vi.fn(),
  proxyWmsDeConexion:  vi.fn(),
  proxyLeyendaDeConexion: vi.fn(),
}));

vi.mock('../src/modules/geovisores/geovisores.service.js', () => ({
  listarWorkspacesDeConexion: vi.fn(),
}));

// query() aquí solo lo consume requireModulo — por defecto el admin_sig de
// prueba tiene los módulos habilitados.
vi.mock('../src/config/database.js', () => ({
  query:     vi.fn().mockResolvedValue({ rows: [{ puede_ver: true, puede_editar: true }] }),
  getClient: vi.fn(),
}));

vi.mock('../src/utils/auditLog.js', () => ({
  registrarAuditoria: vi.fn(),
}));

import * as conexionService from '../src/modules/geovisores/conexionesGeoserver.service.js';
import { listarWorkspacesDeConexion } from '../src/modules/geovisores/geovisores.service.js';
import { query } from '../src/config/database.js';

const adminToken = jwt.sign(
  { id: 'uuid-admin', email: 'admin@iiap.org.co', rol: 'admin_sig' },
  process.env.JWT_SECRET,
);
const superToken = jwt.sign(
  { id: 'uuid-super', email: 'super@iiap.org.co', rol: 'super_admin' },
  process.env.JWT_SECRET,
);
const pubToken = jwt.sign(
  { id: 'uuid-pub', email: 'pub@iiap.org.co', rol: 'publico' },
  process.env.JWT_SECRET,
);

describe('Conexiones GeoServer routes — auth guards via supertest', () => {
  let app;

  beforeEach(async () => {
    vi.clearAllMocks();
    query.mockResolvedValue({ rows: [{ puede_ver: true, puede_editar: true }] });
    app = (await import('../src/app.js')).default;
  });

  it('GET /api/admin/conexiones-geoserver → 401 sin token', async () => {
    const res = await request(app).get('/api/admin/conexiones-geoserver');
    expect(res.status).toBe(401);
  });

  it('GET /api/admin/conexiones-geoserver → 403 con rol publico', async () => {
    const res = await request(app)
      .get('/api/admin/conexiones-geoserver')
      .set('Authorization', `Bearer ${pubToken}`);
    expect(res.status).toBe(403);
  });

  it('GET /api/admin/conexiones-geoserver/:id/workspaces → admin_sig con módulo geovisores habilitado obtiene 200', async () => {
    listarWorkspacesDeConexion.mockResolvedValue([{ id: 't_20_hidrologia', nombre: 'Hidrologia', totalCapas: 3 }]);
    const res = await request(app)
      .get('/api/admin/conexiones-geoserver/conexion-1/workspaces')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(listarWorkspacesDeConexion).toHaveBeenCalledWith('conexion-1');
    expect(res.body).toEqual([{ id: 't_20_hidrologia', nombre: 'Hidrologia', totalCapas: 3 }]);
  });

  it('GET /api/admin/conexiones-geoserver/:id/workspaces → 403 si admin_sig no tiene el módulo geovisores habilitado', async () => {
    query.mockResolvedValueOnce({ rows: [] }); // sin fila en admin_permisos_modulo
    const res = await request(app)
      .get('/api/admin/conexiones-geoserver/conexion-1/workspaces')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(403);
    expect(listarWorkspacesDeConexion).not.toHaveBeenCalled();
  });

  it('GET /api/admin/conexiones-geoserver/:id/wms → transmite la imagen devuelta por el proxy', async () => {
    conexionService.proxyWmsDeConexion.mockResolvedValue({
      status: 200,
      headers: new Map([['content-type', 'image/png']]),
      arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer,
    });
    const res = await request(app)
      .get('/api/admin/conexiones-geoserver/conexion-1/wms?layers=t_20_hidrologia:rios&format=image/png')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/image\/png/);
    expect(conexionService.proxyWmsDeConexion).toHaveBeenCalledWith('conexion-1', expect.any(URLSearchParams), undefined);
  });

  it('GET /api/admin/conexiones-geoserver/:id/wms → 400 si la geometría de filtro es inválida', async () => {
    const res = await request(app)
      .get('/api/admin/conexiones-geoserver/conexion-1/wms')
      .query({ layers: 'x', geometria: JSON.stringify({ type: 'Point', coordinates: [0, 0] }) })
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(400);
    expect(conexionService.proxyWmsDeConexion).not.toHaveBeenCalled();
  });

  it('GET /api/admin/conexiones-geoserver/:id/leyenda/:capaId → transmite la leyenda', async () => {
    conexionService.proxyLeyendaDeConexion.mockResolvedValue({
      status: 200,
      headers: new Map([['content-type', 'image/png']]),
      arrayBuffer: async () => new Uint8Array([1]).buffer,
    });
    const res = await request(app)
      .get('/api/admin/conexiones-geoserver/conexion-1/leyenda/t_20_hidrologia:rios')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(conexionService.proxyLeyendaDeConexion).toHaveBeenCalledWith('conexion-1', 't_20_hidrologia:rios');
  });

  it('super_admin también puede acceder a workspaces sin pasar por requireModulo', async () => {
    listarWorkspacesDeConexion.mockResolvedValue([]);
    const res = await request(app)
      .get('/api/admin/conexiones-geoserver/conexion-1/workspaces')
      .set('Authorization', `Bearer ${superToken}`);
    expect(res.status).toBe(200);
  });

  it('POST /api/admin/conexiones-geoserver → admin_sig no puede crear (solo super_admin)', async () => {
    const res = await request(app)
      .post('/api/admin/conexiones-geoserver')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ nombre: 'X', url: 'https://x.test', tipo: 'externo' });
    expect(res.status).toBe(403);
    expect(conexionService.create).not.toHaveBeenCalled();
  });

  it('POST /api/admin/conexiones-geoserver → tipo "externo" sin credenciales se acepta (super_admin)', async () => {
    conexionService.create.mockResolvedValue({ id: 'nueva', nombre: 'WMS Externo', tipo: 'externo' });
    const res = await request(app)
      .post('/api/admin/conexiones-geoserver')
      .set('Authorization', `Bearer ${superToken}`)
      .send({ nombre: 'WMS Externo', url: 'https://wms.otrainstitucion.gov.co', tipo: 'externo' });
    expect(res.status).toBe(201);
    const [dataEnviada] = conexionService.create.mock.calls[0];
    expect(dataEnviada.tipo).toBe('externo');
    expect(dataEnviada.usuarioLectura).toBeUndefined();
    expect(dataEnviada.password).toBeUndefined();
  });

  it('POST /api/admin/conexiones-geoserver → tipo "propio" sin credenciales se rechaza con 422', async () => {
    const res = await request(app)
      .post('/api/admin/conexiones-geoserver')
      .set('Authorization', `Bearer ${superToken}`)
      .send({ nombre: 'GeoServer IIAP', url: 'https://geo.iiap.org.co', tipo: 'propio' });
    expect(res.status).toBe(422);
    expect(conexionService.create).not.toHaveBeenCalled();
  });

  it('POST /api/admin/conexiones-geoserver → sin tipo explícito, exige credenciales (default "propio")', async () => {
    const res = await request(app)
      .post('/api/admin/conexiones-geoserver')
      .set('Authorization', `Bearer ${superToken}`)
      .send({ nombre: 'GeoServer IIAP', url: 'https://geo.iiap.org.co' });
    expect(res.status).toBe(422);
  });
});
