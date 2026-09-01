import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import app from '../src/app.js';

vi.mock('../src/modules/public/public.service.js', () => ({
  getConfiguracionPublica: vi.fn(),
}));

vi.mock('../src/config/database.js', () => ({
  query: vi.fn(),
  getClient: vi.fn(),
}));

import * as publicService from '../src/modules/public/public.service.js';

describe('GET /api/v1/public/configuracion', () => {
  beforeEach(() => vi.clearAllMocks());

  it('retorna 200 sin ningún header de autenticación', async () => {
    publicService.getConfiguracionPublica.mockResolvedValue({
      politicaPrivacidad: 'Texto legal.',
      siteName: 'VIGIIAP',
      siteDesc: 'Visor y Gestor de Información Ambiental del IIAP',
    });

    const res = await request(app).get('/api/v1/public/configuracion');

    expect(res.status).toBe(200);
  });

  it('propaga el error al middleware de errores si el service falla', async () => {
    publicService.getConfiguracionPublica.mockRejectedValue(new Error('DB down'));

    const res = await request(app).get('/api/v1/public/configuracion');

    expect(res.status).toBe(500);
  });

  it('devuelve únicamente las 3 claves whitelisteadas — nunca el objeto de configuración completo', async () => {
    publicService.getConfiguracionPublica.mockResolvedValue({
      politicaPrivacidad: 'Texto legal.',
      siteName: 'VIGIIAP',
      siteDesc: 'Visor y Gestor de Información Ambiental del IIAP',
    });

    const res = await request(app).get('/api/v1/public/configuracion');

    expect(Object.keys(res.body).sort()).toEqual(
      ['politicaPrivacidad', 'siteDesc', 'siteName'].sort(),
    );
    // Ninguna clave sensible/interna (ej. mail_remitente, modoMantenimiento,
    // mensajeMantenimiento) debe filtrarse a través de este endpoint público.
    expect(res.body).not.toHaveProperty('mail_remitente');
    expect(res.body).not.toHaveProperty('mensajeMantenimiento');
    expect(res.body).not.toHaveProperty('modoMantenimiento');
  });

  it('retorna null en las claves ausentes en lugar de omitirlas', async () => {
    publicService.getConfiguracionPublica.mockResolvedValue({
      politicaPrivacidad: null,
      siteName: null,
      siteDesc: null,
    });

    const res = await request(app).get('/api/v1/public/configuracion');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      politicaPrivacidad: null,
      siteName: null,
      siteDesc: null,
    });
  });

  it('también responde en el alias /api/public/configuracion', async () => {
    publicService.getConfiguracionPublica.mockResolvedValue({
      politicaPrivacidad: 'Texto legal.',
      siteName: 'VIGIIAP',
      siteDesc: 'Descripción',
    });

    const res = await request(app).get('/api/public/configuracion');
    expect(res.status).toBe(200);
  });
});
