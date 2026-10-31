/**
 * Integración de rutas /api/analitica — auth guards vía supertest.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';

vi.mock('../src/modules/analitica/analitica.service.js', () => ({
  registrarPageview: vi.fn(),
  getResumen: vi.fn(),
  getPaginasTop: vi.fn(),
  getDispositivos: vi.fn(),
  getFuentesTrafico: vi.fn(),
  getEntradaSalida: vi.fn(),
  getUbicaciones: vi.fn(),
  getSesionesRecientes: vi.fn(),
  registrarEvento: vi.fn(),
  getEventosTop: vi.fn(),
  getTiempoReal: vi.fn(),
  getEmbudos: vi.fn(),
  getFlujoNavegacion: vi.fn(),
}));

// query() aquí solo lo consume requireModulo (tienePermisoModulo) — el
// admin_sig de prueba tiene el módulo 'actividad' habilitado por defecto.
vi.mock('../src/config/database.js', () => ({
  query: vi.fn().mockResolvedValue({ rows: [{ puede_ver: true, puede_editar: true }] }),
  getClient: vi.fn(),
}));

import * as analiticaService from '../src/modules/analitica/analitica.service.js';

describe('Rutas /api/analitica — auth guards', () => {
  let app;

  beforeEach(async () => {
    vi.clearAllMocks();
    app = (await import('../src/app.js')).default;
  });

  const adminToken = jwt.sign(
    { id: 'uuid-admin', email: 'admin@iiap.org.co', rol: 'admin_sig' },
    process.env.JWT_SECRET,
  );

  const PAGEVIEW_VALIDO = {
    sessionId: '11111111-1111-1111-1111-111111111111',
    ruta: '/mapas', dispositivo: 'escritorio',
  };

  it('POST /api/analitica/pageview → 204 sin autenticación (beacon público y anónimo)', async () => {
    analiticaService.registrarPageview.mockResolvedValue(undefined);
    const res = await request(app).post('/api/analitica/pageview').send(PAGEVIEW_VALIDO);
    expect(res.status).toBe(204);
  });

  it('POST /api/analitica/pageview → funciona igual con un token de sesión adjunto (se ignora)', async () => {
    analiticaService.registrarPageview.mockResolvedValue(undefined);
    const res = await request(app)
      .post('/api/analitica/pageview')
      .set('Authorization', `Bearer ${adminToken}`)
      .send(PAGEVIEW_VALIDO);
    expect(res.status).toBe(204);
  });

  it('GET /api/analitica/resumen → 401 sin token', async () => {
    const res = await request(app).get('/api/analitica/resumen');
    expect(res.status).toBe(401);
  });

  it('GET /api/analitica/resumen → 403 con rol no admin_sig', async () => {
    const token = jwt.sign({ id: 'u1', email: 'i@iiap.org.co', rol: 'investigador' }, process.env.JWT_SECRET);
    const res = await request(app).get('/api/analitica/resumen').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(403);
  });

  it('GET /api/analitica/resumen → 200 con token admin_sig y módulo actividad habilitado', async () => {
    analiticaService.getResumen.mockResolvedValue({ paginasVistas: {} });
    const res = await request(app).get('/api/analitica/resumen').set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
  });

  it('GET /api/analitica/ubicaciones y /sesiones-recientes → 401 sin token', async () => {
    expect((await request(app).get('/api/analitica/ubicaciones')).status).toBe(401);
    expect((await request(app).get('/api/analitica/sesiones-recientes')).status).toBe(401);
  });

  it('GET /api/analitica/sesiones-recientes → 403 con rol no admin_sig (la IP no es pública)', async () => {
    const token = jwt.sign({ id: 'u1', email: 'i@iiap.org.co', rol: 'investigador' }, process.env.JWT_SECRET);
    const res = await request(app).get('/api/analitica/sesiones-recientes').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(403);
  });

  it('GET /api/analitica/ubicaciones y /sesiones-recientes → 200 con token admin_sig', async () => {
    analiticaService.getUbicaciones.mockResolvedValue({ paises: [], departamentos: [], sinUbicacion: 0 });
    analiticaService.getSesionesRecientes.mockResolvedValue([]);
    const a = await request(app).get('/api/analitica/ubicaciones').set('Authorization', `Bearer ${adminToken}`);
    const b = await request(app).get('/api/analitica/sesiones-recientes').set('Authorization', `Bearer ${adminToken}`);
    expect([a.status, b.status]).toEqual([200, 200]);
  });

  it('GET /api/analitica/paginas-top → 401 sin token', async () => {
    const res = await request(app).get('/api/analitica/paginas-top');
    expect(res.status).toBe(401);
  });

  it('GET /api/analitica/dispositivos → 200 con token admin_sig', async () => {
    analiticaService.getDispositivos.mockResolvedValue([]);
    const res = await request(app).get('/api/analitica/dispositivos').set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
  });

  it('POST /api/analitica/evento → 204 sin autenticación con un evento del catálogo', async () => {
    analiticaService.registrarEvento.mockResolvedValue(true);
    const res = await request(app).post('/api/analitica/evento')
      .send({ sessionId: '11111111-1111-4111-8111-111111111111', nombre: 'descarga_mapa', recurso: 'rio-atrato' });
    expect(res.status).toBe(204);
    expect(analiticaService.registrarEvento).toHaveBeenCalledWith(expect.objectContaining({ nombre: 'descarga_mapa' }));
  });

  it('POST /api/analitica/evento → 400 con un nombre fuera del catálogo', async () => {
    const res = await request(app).post('/api/analitica/evento')
      .send({ sessionId: '11111111-1111-4111-8111-111111111111', nombre: 'inventado' });
    expect(res.status).toBe(400);
    expect(analiticaService.registrarEvento).not.toHaveBeenCalled();
  });

  it('GET /api/analitica/eventos-top y /tiempo-real → 401 sin token', async () => {
    expect((await request(app).get('/api/analitica/eventos-top')).status).toBe(401);
    expect((await request(app).get('/api/analitica/tiempo-real')).status).toBe(401);
  });

  it('GET /api/analitica/eventos-top y /tiempo-real → 200 con token admin_sig', async () => {
    analiticaService.getEventosTop.mockResolvedValue({ eventos: [], recursos: [] });
    analiticaService.getTiempoReal.mockResolvedValue({ ventanaMin: 5, visitantesActivos: 0, paginasActuales: [] });
    const eventos = await request(app).get('/api/analitica/eventos-top').set('Authorization', `Bearer ${adminToken}`);
    const vivo = await request(app).get('/api/analitica/tiempo-real').set('Authorization', `Bearer ${adminToken}`);
    expect(eventos.status).toBe(200);
    expect(vivo.status).toBe(200);
  });

  it('GET /api/analitica/embudos y /flujo-navegacion → 401 sin token y 403 con un rol que no es admin_sig', async () => {
    expect((await request(app).get('/api/analitica/embudos')).status).toBe(401);
    expect((await request(app).get('/api/analitica/flujo-navegacion')).status).toBe(401);
    const token = jwt.sign({ id: 'u1', email: 'i@iiap.org.co', rol: 'investigador' }, process.env.JWT_SECRET);
    expect((await request(app).get('/api/analitica/embudos').set('Authorization', `Bearer ${token}`)).status).toBe(403);
  });

  it('GET /api/analitica/embudos y /flujo-navegacion → 200 con token admin_sig', async () => {
    analiticaService.getEmbudos.mockResolvedValue([]);
    analiticaService.getFlujoNavegacion.mockResolvedValue([]);
    const embudos = await request(app).get('/api/analitica/embudos').set('Authorization', `Bearer ${adminToken}`);
    const flujo = await request(app).get('/api/analitica/flujo-navegacion').set('Authorization', `Bearer ${adminToken}`);
    expect(embudos.status).toBe(200);
    expect(flujo.status).toBe(200);
  });

  it('GET /api/analitica/fuentes-trafico → 401 sin token', async () => {
    const res = await request(app).get('/api/analitica/fuentes-trafico');
    expect(res.status).toBe(401);
  });

  it('GET /api/analitica/entrada-salida → 200 con token admin_sig', async () => {
    analiticaService.getEntradaSalida.mockResolvedValue({ entradas: [], salidas: [] });
    const res = await request(app).get('/api/analitica/entrada-salida').set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
  });
});
