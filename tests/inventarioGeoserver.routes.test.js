import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';

vi.mock('../src/modules/geovisores/inventarioGeoserver.service.js', () => ({
  sincronizarConexion: vi.fn(),
  obtenerInventarioAdmin: vi.fn(),
}));
vi.mock('../src/modules/geovisores/conexionesGeoserver.service.js', () => ({
  getAll: vi.fn(), getSeleccionables: vi.fn(), getById: vi.fn(), create: vi.fn(), update: vi.fn(),
  actualizarCapasNuevasAuto: vi.fn(), remove: vi.fn(), proxyWmsDeConexion: vi.fn(), proxyLeyendaDeConexion: vi.fn(),
}));
vi.mock('../src/modules/geovisores/geovisores.service.js', () => ({ listarWorkspacesDeConexion: vi.fn() }));
vi.mock('../src/config/database.js', () => ({
  query: vi.fn().mockResolvedValue({ rows: [{ puede_ver: true, puede_editar: true }] }),
  getClient: vi.fn(),
}));
vi.mock('../src/utils/auditLog.js', () => ({ registrarAuditoria: vi.fn() }));
vi.mock('../src/utils/ssrfGuard.js', () => ({
  urlApuntaARedPrivada: vi.fn().mockResolvedValue(false),
  dnsLookupSeguro: vi.fn(),
}));

import { sincronizarConexion, obtenerInventarioAdmin } from '../src/modules/geovisores/inventarioGeoserver.service.js';
import { getById } from '../src/modules/geovisores/conexionesGeoserver.service.js';
import { query } from '../src/config/database.js';
import { registrarAuditoria } from '../src/utils/auditLog.js';

const token = (rol) => jwt.sign({ id: `uuid-${rol}`, email: `${rol}@iiap.org.co`, rol }, process.env.JWT_SECRET);
const adminToken = token('admin_sig');
const superToken = token('super_admin');
const pubToken = token('publico');

// El limitador es de proceso: cada prueba usa su propia conexión para no heredar el cupo de otra.
let contador = 0;
const nuevaConexion = () => {
  contador += 1;
  return `00000000-0000-4000-8000-${String(contador).padStart(12, '0')}`;
};

const RESULTADO = { estado: 'ok', fuente: 'rest+ogc', resumen: { capas: { nuevos: 1, cambiados: 0, eliminados: 0 } }, duracion_ms: 120, error: null };
const sinModulo = (editar) => query.mockResolvedValue({ rows: [{ puede_ver: true, puede_editar: editar }] });

describe('Inventario GeoServer — rutas de administración', () => {
  let app;

  beforeEach(async () => {
    vi.clearAllMocks();
    query.mockResolvedValue({ rows: [{ puede_ver: true, puede_editar: true }] });
    getById.mockResolvedValue({ id: 'x', nombre: 'GeoServer IIAP' });
    sincronizarConexion.mockResolvedValue(RESULTADO);
    obtenerInventarioAdmin.mockResolvedValue({ sincronizacion: null, espacios: [], capas: [], grupos: [], estilos: [] });
    app = (await import('../src/app.js')).default;
  });

  describe('POST /:id/sincronizar', () => {
    it('401 sin sesión y 403 con rol publico', async () => {
      const id = nuevaConexion();
      expect((await request(app).post(`/api/admin/conexiones-geoserver/${id}/sincronizar`)).status).toBe(401);
      expect((await request(app).post(`/api/admin/conexiones-geoserver/${id}/sincronizar`).set('Authorization', `Bearer ${pubToken}`)).status).toBe(403);
      expect(sincronizarConexion).not.toHaveBeenCalled();
    });

    it('403 si el admin tiene el módulo geovisores solo para ver (no editar)', async () => {
      sinModulo(false);
      const res = await request(app).post(`/api/admin/conexiones-geoserver/${nuevaConexion()}/sincronizar`).set('Authorization', `Bearer ${adminToken}`);
      expect(res.status).toBe(403);
      expect(sincronizarConexion).not.toHaveBeenCalled();
    });

    it('un admin con permiso de editar sincroniza, recibe el resultado y queda en la auditoría', async () => {
      const id = nuevaConexion();
      const res = await request(app).post(`/api/admin/conexiones-geoserver/${id}/sincronizar`).set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body).toEqual(RESULTADO);
      expect(sincronizarConexion).toHaveBeenCalledWith(id, { origen: 'manual' });
      expect(registrarAuditoria).toHaveBeenCalledWith(expect.objectContaining({
        accion: 'sincronizar_inventario_geoserver', modulo: 'geovisores', entidadId: id, usuarioId: 'uuid-admin_sig', resultado: 'exito',
      }));
    });

    it('super_admin pasa siempre', async () => {
      sinModulo(false);
      const res = await request(app).post(`/api/admin/conexiones-geoserver/${nuevaConexion()}/sincronizar`).set('Authorization', `Bearer ${superToken}`);
      expect(res.status).toBe(200);
    });

    it('una segunda sincronización de la misma conexión dentro del minuto responde 429', async () => {
      const id = nuevaConexion();
      const url = `/api/admin/conexiones-geoserver/${id}/sincronizar`;

      expect((await request(app).post(url).set('Authorization', `Bearer ${adminToken}`)).status).toBe(200);
      const segunda = await request(app).post(url).set('Authorization', `Bearer ${superToken}`);

      expect(segunda.status).toBe(429);
      expect(sincronizarConexion).toHaveBeenCalledTimes(1);
      // Otra conexión no comparte el cupo.
      expect((await request(app).post(`/api/admin/conexiones-geoserver/${nuevaConexion()}/sincronizar`).set('Authorization', `Bearer ${adminToken}`)).status).toBe(200);
    });

    it('una sincronización ya en curso responde 409', async () => {
      sincronizarConexion.mockRejectedValue(Object.assign(new Error('Ya hay una sincronización en curso para esta conexión'), { status: 409, code: 'SINCRONIZACION_EN_CURSO' }));
      const res = await request(app).post(`/api/admin/conexiones-geoserver/${nuevaConexion()}/sincronizar`).set('Authorization', `Bearer ${adminToken}`);
      expect(res.status).toBe(409);
    });

    it('un id que no es UUID responde 422 sin tocar GeoServer', async () => {
      const res = await request(app).post('/api/admin/conexiones-geoserver/no-es-uuid/sincronizar').set('Authorization', `Bearer ${superToken}`);
      expect(res.status).toBe(422);
      expect(sincronizarConexion).not.toHaveBeenCalled();
    });

    it('si la sincronización terminó en error la auditoría lo refleja', async () => {
      sincronizarConexion.mockResolvedValue({ ...RESULTADO, estado: 'error', error: 'GeoServer no respondió' });
      await request(app).post(`/api/admin/conexiones-geoserver/${nuevaConexion()}/sincronizar`).set('Authorization', `Bearer ${adminToken}`);
      expect(registrarAuditoria).toHaveBeenCalledWith(expect.objectContaining({ resultado: 'fallo' }));
    });
  });

  describe('GET /:id/inventario', () => {
    const ID = '11111111-1111-4111-8111-111111111111';

    it('401 sin sesión, 403 con rol publico y 403 sin el módulo geovisores', async () => {
      expect((await request(app).get(`/api/admin/conexiones-geoserver/${ID}/inventario`)).status).toBe(401);
      expect((await request(app).get(`/api/admin/conexiones-geoserver/${ID}/inventario`).set('Authorization', `Bearer ${pubToken}`)).status).toBe(403);
      query.mockResolvedValue({ rows: [] });
      expect((await request(app).get(`/api/admin/conexiones-geoserver/${ID}/inventario`).set('Authorization', `Bearer ${adminToken}`)).status).toBe(403);
      expect(obtenerInventarioAdmin).not.toHaveBeenCalled();
    });

    it('con solo permiso de ver devuelve el inventario y por defecto excluye lo eliminado', async () => {
      sinModulo(false);
      const res = await request(app).get(`/api/admin/conexiones-geoserver/${ID}/inventario`).set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ sincronizacion: null, espacios: [], capas: [], grupos: [], estilos: [] });
      expect(obtenerInventarioAdmin).toHaveBeenCalledWith(ID, { incluirEliminados: false });
    });

    it('incluirEliminados=true se respeta y un valor raro responde 422', async () => {
      await request(app).get(`/api/admin/conexiones-geoserver/${ID}/inventario?incluirEliminados=true`).set('Authorization', `Bearer ${superToken}`);
      expect(obtenerInventarioAdmin).toHaveBeenCalledWith(ID, { incluirEliminados: true });

      const res = await request(app).get(`/api/admin/conexiones-geoserver/${ID}/inventario?incluirEliminados=quizas`).set('Authorization', `Bearer ${superToken}`);
      expect(res.status).toBe(422);
    });

    it('una conexión inexistente responde 404', async () => {
      getById.mockRejectedValue(Object.assign(new Error('Conexión GeoServer no encontrada'), { status: 404 }));
      const res = await request(app).get(`/api/admin/conexiones-geoserver/${ID}/inventario`).set('Authorization', `Bearer ${superToken}`);
      expect(res.status).toBe(404);
    });
  });
});
