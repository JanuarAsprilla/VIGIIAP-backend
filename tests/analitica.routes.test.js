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

  it('GET /api/analitica/paginas-top → 401 sin token', async () => {
    const res = await request(app).get('/api/analitica/paginas-top');
    expect(res.status).toBe(401);
  });

  it('GET /api/analitica/dispositivos → 200 con token admin_sig', async () => {
    analiticaService.getDispositivos.mockResolvedValue([]);
    const res = await request(app).get('/api/analitica/dispositivos').set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
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
