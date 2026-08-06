/**
 * Tests para src/instrument.js — bootstrap de Sentry (APM).
 *
 * instrument.js ejecuta Sentry.init() como efecto secundario al importarse,
 * por lo que cada test re-importa el módulo con vi.resetModules() tras ajustar
 * las variables de entorno relevantes (SENTRY_DSN, NODE_ENV).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const initMock = vi.fn();
const httpIntegrationMock = vi.fn(() => ({ name: 'Http' }));

vi.mock('@sentry/node', () => ({
  init: initMock,
  httpIntegration: httpIntegrationMock,
}));

vi.mock('dotenv/config', () => ({}));

const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  vi.clearAllMocks();
  vi.resetModules();
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

describe('instrument.js — inicialización de Sentry', () => {
  it('inicializa Sentry deshabilitado cuando no hay SENTRY_DSN', async () => {
    delete process.env.SENTRY_DSN;
    process.env.NODE_ENV = 'test';

    await import('../src/instrument.js');

    expect(initMock).toHaveBeenCalledTimes(1);
    const config = initMock.mock.calls[0][0];
    expect(config.enabled).toBe(false);
  });

  it('inicializa Sentry deshabilitado cuando hay SENTRY_DSN pero NODE_ENV no es production', async () => {
    process.env.SENTRY_DSN = 'https://key@sentry.example.com/1';
    process.env.NODE_ENV   = 'development';

    await import('../src/instrument.js');

    const config = initMock.mock.calls[0][0];
    expect(config.dsn).toBe('https://key@sentry.example.com/1');
    expect(config.enabled).toBe(false);
  });

  it('inicializa Sentry habilitado cuando hay SENTRY_DSN y NODE_ENV es production', async () => {
    process.env.SENTRY_DSN = 'https://key@sentry.example.com/1';
    process.env.NODE_ENV   = 'production';

    await import('../src/instrument.js');

    const config = initMock.mock.calls[0][0];
    expect(config.enabled).toBe(true);
    expect(config.environment).toBe('production');
  });

  it('usa "development" como environment por defecto cuando NODE_ENV no está definido', async () => {
    delete process.env.SENTRY_DSN;
    delete process.env.NODE_ENV;

    await import('../src/instrument.js');

    const config = initMock.mock.calls[0][0];
    expect(config.environment).toBe('development');
  });

  it('registra httpIntegration en la lista de integraciones', async () => {
    delete process.env.SENTRY_DSN;
    process.env.NODE_ENV = 'test';

    await import('../src/instrument.js');

    expect(httpIntegrationMock).toHaveBeenCalled();
    const config = initMock.mock.calls[0][0];
    expect(config.integrations).toHaveLength(1);
  });
});

describe('instrument.js — beforeSend() redacta datos sensibles', () => {
  async function getBeforeSend() {
    delete process.env.SENTRY_DSN;
    process.env.NODE_ENV = 'test';
    await import('../src/instrument.js');
    return initMock.mock.calls[0][0].beforeSend;
  }

  it('elimina los headers authorization y cookie del evento', async () => {
    const beforeSend = await getBeforeSend();
    const event = {
      request: {
        headers: { authorization: 'Bearer secret', cookie: 'sid=abc', 'x-other': 'ok' },
      },
    };

    const result = beforeSend(event);

    expect(result.request.headers.authorization).toBeUndefined();
    expect(result.request.headers.cookie).toBeUndefined();
    expect(result.request.headers['x-other']).toBe('ok');
  });

  it('redacta campos sensibles del body cuando request.data es un objeto', async () => {
    const beforeSend = await getBeforeSend();
    const event = {
      request: {
        data: { password: 'hunter2', totp_secret: 'JBSW', nombre: 'Juan' },
      },
    };

    const result = beforeSend(event);

    expect(result.request.data.password).toBe('[Redacted]');
    expect(result.request.data.totp_secret).toBe('[Redacted]');
    expect(result.request.data.nombre).toBe('Juan');
  });

  it('retorna el evento sin modificar cuando no hay request', async () => {
    const beforeSend = await getBeforeSend();
    const event = { message: 'algo falló' };

    const result = beforeSend(event);

    expect(result).toBe(event);
  });

  it('no lanza cuando request.data no es un objeto', async () => {
    const beforeSend = await getBeforeSend();
    const event = { request: { data: 'raw-string-body' } };

    expect(() => beforeSend(event)).not.toThrow();
    expect(beforeSend(event)).toBe(event);
  });

  it('retorna el mismo evento (referencia) al finalizar', async () => {
    const beforeSend = await getBeforeSend();
    const event = { request: { headers: {}, data: {} } };

    expect(beforeSend(event)).toBe(event);
  });
});
