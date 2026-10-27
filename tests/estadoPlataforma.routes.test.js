/**
 * GET /api/v1/estado y pausa total de la API durante el mantenimiento — supertest sobre la app real.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import request from 'supertest';

vi.mock('../src/config/database.js', () => ({
  query: vi.fn().mockResolvedValue({ rows: [] }),
  getClient: vi.fn(),
}));

import { setMaintenanceState } from '../src/middlewares/maintenanceMode.js';

describe('estado de la plataforma y modo mantenimiento', () => {
  let app;
  beforeEach(async () => {
    app = (await import('../src/app.js')).default;
    setMaintenanceState({ modoMantenimiento: false, mensajeMantenimiento: '' });
  });
  afterEach(() => setMaintenanceState({ modoMantenimiento: false, mensajeMantenimiento: '' }));

  it('GET /api/v1/estado informa que la plataforma está operativa, sin sesión y sin caché', async () => {
    const res = await request(app).get('/api/v1/estado');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ mantenimiento: false, mensaje: null });
    expect(res.headers['cache-control']).toMatch(/no-store/);
  });

  it('durante el mantenimiento /estado sigue respondiendo con el mensaje', async () => {
    setMaintenanceState({ modoMantenimiento: true, mensajeMantenimiento: 'Volvemos a las 6 pm.' });

    const res = await request(app).get('/api/v1/estado');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ mantenimiento: true, mensaje: 'Volvemos a las 6 pm.' });
  });

  it('durante el mantenimiento una ruta de datos responde 503 con maintenance:true', async () => {
    setMaintenanceState({ modoMantenimiento: true, mensajeMantenimiento: 'Volvemos a las 6 pm.' });

    const res = await request(app).get('/api/v1/mapas');

    expect(res.status).toBe(503);
    expect(res.body).toMatchObject({ maintenance: true, error: 'Volvemos a las 6 pm.' });
    expect(res.headers['retry-after']).toBe('300');
  });

  it('durante el mantenimiento el acceso como visitante queda bloqueado', async () => {
    setMaintenanceState({ modoMantenimiento: true });

    const res = await request(app).post('/api/v1/auth/visitante').send({ nombre: 'Ana' });

    expect(res.status).toBe(503);
  });

  it('durante el mantenimiento el login sigue disponible (responde por validación, no por mantenimiento)', async () => {
    setMaintenanceState({ modoMantenimiento: true });

    const res = await request(app).post('/api/v1/auth/login').send({});

    expect(res.status).not.toBe(503);
  });

  it('con el mantenimiento apagado las rutas de datos no se ven afectadas por la compuerta', async () => {
    const res = await request(app).get('/api/v1/mapas');

    expect(res.body.maintenance).toBeUndefined();
  });
});
