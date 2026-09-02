import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../src/config/database.js', () => ({
  query: vi.fn(),
}));

vi.mock('../src/utils/logger.js', () => ({
  default: { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() },
}));

vi.mock('../src/modules/admin/admin.service.js', () => ({
  getAdminEmails: vi.fn(),
}));

vi.mock('../src/utils/mailer.js', () => ({
  notifyErrorCritico: vi.fn(),
}));

import { query } from '../src/config/database.js';
import { getAdminEmails } from '../src/modules/admin/admin.service.js';
import { notifyErrorCritico } from '../src/utils/mailer.js';
import { registrarError } from '../src/utils/errorTracking.js';

describe('registrarError()', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getAdminEmails.mockResolvedValue(['admin@iiap.gov.co']);
    notifyErrorCritico.mockResolvedValue(undefined);
  });

  it('inserta el error y alerta a los admins la primera vez que ocurre', async () => {
    query
      .mockResolvedValueOnce({ rows: [{ ocurrencias: 1, notificado_en: null }] }) // INSERT ... RETURNING
      .mockResolvedValueOnce({ rows: [] }); // UPDATE notificado_en

    const err = new Error('DB unreachable');
    await registrarError({ err, metodo: 'GET', ruta: '/api/v1/mapas' });

    expect(query).toHaveBeenNthCalledWith(1, expect.stringContaining('INSERT INTO error_log'), [
      expect.any(String), 'DB unreachable', err.stack, 'GET', '/api/v1/mapas', 500,
    ]);
    expect(notifyErrorCritico).toHaveBeenCalledWith(
      expect.objectContaining({ adminEmail: 'admin@iiap.gov.co', mensaje: 'DB unreachable', ocurrencias: 1 })
    );
  });

  it('no vuelve a alertar si el mismo error ya se notificó hace menos de 1 hora', async () => {
    const hace10min = new Date(Date.now() - 10 * 60 * 1000).toISOString();
    query.mockResolvedValueOnce({ rows: [{ ocurrencias: 5, notificado_en: hace10min }] });

    await registrarError({ err: new Error('boom'), metodo: 'POST', ruta: '/api/v1/solicitudes' });

    expect(notifyErrorCritico).not.toHaveBeenCalled();
    expect(query).toHaveBeenCalledTimes(1); // solo el INSERT/UPDATE de ocurrencias, sin el UPDATE de notificado_en
  });

  it('vuelve a alertar si pasó más de 1 hora desde la última notificación', async () => {
    const hace2Horas = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
    query
      .mockResolvedValueOnce({ rows: [{ ocurrencias: 12, notificado_en: hace2Horas }] })
      .mockResolvedValueOnce({ rows: [] });

    await registrarError({ err: new Error('boom'), metodo: 'POST', ruta: '/api/v1/solicitudes' });

    expect(notifyErrorCritico).toHaveBeenCalledOnce();
  });

  it('agrupa por fingerprint: mismo método+ruta+mensaje usa el mismo hash', async () => {
    query.mockResolvedValue({ rows: [{ ocurrencias: 1, notificado_en: null }] });

    await registrarError({ err: new Error('x'), metodo: 'GET', ruta: '/a' });
    const fp1 = query.mock.calls[0][1][0];

    query.mockClear();
    query.mockResolvedValue({ rows: [{ ocurrencias: 1, notificado_en: null }] });
    await registrarError({ err: new Error('x'), metodo: 'GET', ruta: '/a' });
    const fp2 = query.mock.calls[0][1][0];

    expect(fp1).toBe(fp2);
  });

  it('un error sin message usa un mensaje por defecto sin lanzar', async () => {
    query.mockResolvedValueOnce({ rows: [{ ocurrencias: 1, notificado_en: null }] });
    query.mockResolvedValueOnce({ rows: [] });

    await expect(registrarError({ err: {}, metodo: 'GET', ruta: '/x' })).resolves.toBeUndefined();
    expect(query.mock.calls[0][1][1]).toBe('Error desconocido');
  });

  it('no lanza ni bloquea el request si la BD falla al registrar el error', async () => {
    query.mockRejectedValueOnce(new Error('DB fail'));
    await expect(registrarError({ err: new Error('boom'), metodo: 'GET', ruta: '/x' })).resolves.toBeUndefined();
    expect(notifyErrorCritico).not.toHaveBeenCalled();
  });

  it('un admin que falla al recibir la alerta no bloquea a los demás', async () => {
    query.mockResolvedValueOnce({ rows: [{ ocurrencias: 1, notificado_en: null }] });
    query.mockResolvedValueOnce({ rows: [] });
    getAdminEmails.mockResolvedValue(['falla@iiap.gov.co', 'ok@iiap.gov.co']);
    notifyErrorCritico.mockImplementation(({ adminEmail }) =>
      adminEmail === 'falla@iiap.gov.co' ? Promise.reject(new Error('SMTP down')) : Promise.resolve()
    );

    await expect(registrarError({ err: new Error('boom'), metodo: 'GET', ruta: '/x' })).resolves.toBeUndefined();
    expect(notifyErrorCritico).toHaveBeenCalledTimes(2);
  });
});

describe('registrarError() — redacción de datos sensibles', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getAdminEmails.mockResolvedValue(['admin@iiap.gov.co']);
    notifyErrorCritico.mockResolvedValue(undefined);
    query.mockResolvedValueOnce({ rows: [{ ocurrencias: 1, notificado_en: null }] });
    query.mockResolvedValueOnce({ rows: [] });
  });

  it('redacta un JWT en el mensaje antes de guardarlo', async () => {
    const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjMifQ.dQw4w9WgXcQ_abc123XYZ';
    const err = new Error(`token inválido: ${jwt}`);
    await registrarError({ err, metodo: 'GET', ruta: '/auth/me' });

    const mensajeGuardado = query.mock.calls[0][1][1];
    expect(mensajeGuardado).not.toContain(jwt);
    expect(mensajeGuardado).toContain('[REDACTED_JWT]');
  });

  it('redacta un header Authorization: Bearer en el stack', async () => {
    const err = new Error('fetch failed');
    err.stack = 'Error: fetch failed\n    Authorization: Bearer abc.def.ghi123';
    await registrarError({ err, metodo: 'GET', ruta: '/x' });

    const stackGuardado = query.mock.calls[0][1][2];
    expect(stackGuardado).not.toContain('abc.def.ghi123');
    expect(stackGuardado).toContain('Authorization: [REDACTED]');
  });

  it('redacta un Bearer suelto sin key: prefijo (p.ej. en un comando curl logueado)', async () => {
    const err = new Error('curl -H "Bearer abc.def.ghi123" https://api.example.com falló');
    await registrarError({ err, metodo: 'GET', ruta: '/x' });

    const mensajeGuardado = query.mock.calls[0][1][1];
    expect(mensajeGuardado).not.toContain('abc.def.ghi123');
  });

  it('redacta el valor de una connection string con credenciales', async () => {
    const err = new Error('conexión fallida: postgres://miuser:miclave123@db.host:5432/vigiiap');
    await registrarError({ err, metodo: 'GET', ruta: '/x' });

    const mensajeGuardado = query.mock.calls[0][1][1];
    expect(mensajeGuardado).not.toContain('miclave123');
    expect(mensajeGuardado).toContain('[REDACTED]@');
  });

  it('redacta un campo password= embebido en el mensaje', async () => {
    const err = new Error('body inválido: password=SuperSecreta123');
    await registrarError({ err, metodo: 'POST', ruta: '/auth/login' });

    const mensajeGuardado = query.mock.calls[0][1][1];
    expect(mensajeGuardado).not.toContain('SuperSecreta123');
    expect(mensajeGuardado).toContain('[REDACTED]');
  });

  it('trunca mensajes extremadamente largos', async () => {
    const err = new Error('x'.repeat(10_000));
    await registrarError({ err, metodo: 'GET', ruta: '/x' });

    const mensajeGuardado = query.mock.calls[0][1][1];
    expect(mensajeGuardado.length).toBeLessThan(6000);
    expect(mensajeGuardado).toContain('truncado');
  });

  it('no altera un mensaje sin datos sensibles', async () => {
    const err = new Error('el servicio de mapas no respondió a tiempo');
    await registrarError({ err, metodo: 'GET', ruta: '/mapas' });

    const mensajeGuardado = query.mock.calls[0][1][1];
    expect(mensajeGuardado).toBe('el servicio de mapas no respondió a tiempo');
  });
});

describe('registrarError() — agrupación tolerante a valores dinámicos', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getAdminEmails.mockResolvedValue(['admin@iiap.gov.co']);
    notifyErrorCritico.mockResolvedValue(undefined);
  });

  it('agrupa el mismo error aunque el mensaje traiga un id numérico distinto', async () => {
    query.mockResolvedValueOnce({ rows: [{ ocurrencias: 1, notificado_en: null }] });
    query.mockResolvedValueOnce({ rows: [] });
    await registrarError({ err: new Error('Usuario 4821 no existe'), metodo: 'GET', ruta: '/usuarios' });
    const fp1 = query.mock.calls[0][1][0];

    query.mockClear();
    query.mockResolvedValueOnce({ rows: [{ ocurrencias: 2, notificado_en: null }] });
    query.mockResolvedValueOnce({ rows: [] });
    await registrarError({ err: new Error('Usuario 99012 no existe'), metodo: 'GET', ruta: '/usuarios' });
    const fp2 = query.mock.calls[0][1][0];

    expect(fp1).toBe(fp2);
  });

  it('agrupa el mismo error aunque la ruta traiga un UUID distinto', async () => {
    query.mockResolvedValueOnce({ rows: [{ ocurrencias: 1, notificado_en: null }] });
    query.mockResolvedValueOnce({ rows: [] });
    await registrarError({
      err: new Error('recurso no encontrado'), metodo: 'GET',
      ruta: '/api/v1/mapas/9f3e2a10-1111-2222-3333-abcdefabcdef',
    });
    const fp1 = query.mock.calls[0][1][0];

    query.mockClear();
    query.mockResolvedValueOnce({ rows: [{ ocurrencias: 2, notificado_en: null }] });
    query.mockResolvedValueOnce({ rows: [] });
    await registrarError({
      err: new Error('recurso no encontrado'), metodo: 'GET',
      ruta: '/api/v1/mapas/00000000-9999-8888-7777-666655554444',
    });
    const fp2 = query.mock.calls[0][1][0];

    expect(fp1).toBe(fp2);
  });

  it('mensajes de tipos de error distintos NO se agrupan entre sí', async () => {
    query.mockResolvedValueOnce({ rows: [{ ocurrencias: 1, notificado_en: null }] });
    query.mockResolvedValueOnce({ rows: [] });
    await registrarError({ err: new Error('timeout de conexión'), metodo: 'GET', ruta: '/x' });
    const fp1 = query.mock.calls[0][1][0];

    query.mockClear();
    query.mockResolvedValueOnce({ rows: [{ ocurrencias: 1, notificado_en: null }] });
    query.mockResolvedValueOnce({ rows: [] });
    await registrarError({ err: new Error('permiso denegado'), metodo: 'GET', ruta: '/x' });
    const fp2 = query.mock.calls[0][1][0];

    expect(fp1).not.toBe(fp2);
  });
});
