import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../src/config/database.js', () => ({ query: vi.fn() }));
vi.mock('../src/utils/logger.js', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { query } from '../src/config/database.js';
import {
  MAX_INTENTOS, esReintentable, esperaMinutos, encolarFallo, procesarPendientes,
} from '../src/utils/correosPendientes.js';

beforeEach(() => vi.resetAllMocks());

describe('esReintentable()', () => {
  it('reintenta los fallos de red y los temporales del servidor SMTP', () => {
    expect(esReintentable(Object.assign(new Error('x'), { code: 'ETIMEDOUT' }))).toBe(true);
    expect(esReintentable(Object.assign(new Error('x'), { code: 'ECONNECTION' }))).toBe(true);
    expect(esReintentable(Object.assign(new Error('x'), { responseCode: 421 }))).toBe(true);
    expect(esReintentable(Object.assign(new Error('x'), { responseCode: 451 }))).toBe(true);
  });

  it('no reintenta los rechazos permanentes (buzón inexistente, mensaje rechazado)', () => {
    expect(esReintentable(Object.assign(new Error('x'), { responseCode: 550 }))).toBe(false);
    expect(esReintentable(Object.assign(new Error('x'), { responseCode: 553 }))).toBe(false);
  });

  it('sí reintenta un fallo de autenticación: el administrador puede corregir la configuración', () => {
    expect(esReintentable(Object.assign(new Error('x'), { code: 'EAUTH', responseCode: 535 }))).toBe(true);
  });

  it('un error sin código se considera temporal', () => {
    expect(esReintentable(new Error('algo falló'))).toBe(true);
  });
});

describe('esperaMinutos()', () => {
  it('crece con cada intento y se queda en el máximo', () => {
    const esperas = [1, 2, 3, 4, 5, 6, 20].map(esperaMinutos);
    expect(esperas.slice(0, 5)).toEqual([...esperas.slice(0, 5)].sort((a, b) => a - b));
    expect(esperas[0]).toBeLessThan(esperas[4]);
    expect(esperas[5]).toBe(esperas[4]);
    expect(esperas[6]).toBe(esperas[4]);
  });
});

describe('encolarFallo()', () => {
  it('guarda el correo con un intento ya consumido y la siguiente fecha', async () => {
    query.mockResolvedValueOnce({ rows: [] });

    await encolarFallo({
      to: 'a@iiap.test', subject: 'Asunto', html: '<p>hola</p>', error: Object.assign(new Error('timeout'), { code: 'ETIMEDOUT' }),
    });

    const [sql, params] = query.mock.calls[0];
    expect(sql).toMatch(/INSERT INTO correos_pendientes/);
    expect(params).toEqual(expect.arrayContaining(['a@iiap.test', 'Asunto', '<p>hola</p>']));
    expect(params.some((p) => typeof p === 'string' && p.includes('timeout'))).toBe(true);
  });

  it('recorta un mensaje de error demasiado largo', async () => {
    query.mockResolvedValueOnce({ rows: [] });

    await encolarFallo({ to: 'a@b.test', subject: 's', html: 'h', error: new Error('x'.repeat(2000)) });

    const mensaje = query.mock.calls[0][1].find((p) => typeof p === 'string' && p.startsWith('xxx'));
    expect(mensaje.length).toBeLessThanOrEqual(500);
  });
});

describe('procesarPendientes()', () => {
  const fila = (extra = {}) => ({ id: 1, destinatario: 'a@iiap.test', asunto: 'Asunto', html: '<p>x</p>', intentos: 1, ...extra });

  it('reclama el lote con SKIP LOCKED y un plazo de arrendamiento', async () => {
    query.mockResolvedValueOnce({ rows: [] });
    query.mockResolvedValueOnce({ rowCount: 0 });

    await procesarPendientes(vi.fn());

    expect(query.mock.calls[0][0]).toMatch(/FOR UPDATE SKIP LOCKED/);
    expect(query.mock.calls[0][0]).toMatch(/UPDATE correos_pendientes/);
  });

  it('un envío correcto marca enviado y borra el cuerpo del correo', async () => {
    const enviar = vi.fn().mockResolvedValue({ messageId: 'ok' });
    query.mockResolvedValueOnce({ rows: [fila()] });
    query.mockResolvedValue({ rowCount: 1 });

    const resultado = await procesarPendientes(enviar);

    expect(enviar).toHaveBeenCalledWith({ to: 'a@iiap.test', subject: 'Asunto', html: '<p>x</p>' });
    const sqlActualizacion = query.mock.calls[1][0];
    expect(sqlActualizacion).toMatch(/estado = 'enviado'/);
    expect(sqlActualizacion).toMatch(/html = NULL/);
    expect(resultado).toMatchObject({ enviados: 1, reprogramados: 0, fallidos: 0 });
  });

  it('un fallo temporal reprograma el correo con un intento más', async () => {
    const enviar = vi.fn().mockRejectedValue(Object.assign(new Error('timeout'), { code: 'ETIMEDOUT' }));
    query.mockResolvedValueOnce({ rows: [fila({ intentos: 2 })] });
    query.mockResolvedValue({ rowCount: 1 });

    const resultado = await procesarPendientes(enviar);

    const [sql, params] = query.mock.calls[1];
    expect(sql).toMatch(/estado = 'pendiente'/);
    expect(params).toEqual(expect.arrayContaining([3]));
    expect(resultado).toMatchObject({ enviados: 0, reprogramados: 1, fallidos: 0 });
  });

  it('al agotar los intentos pasa a fallido y borra el cuerpo', async () => {
    const enviar = vi.fn().mockRejectedValue(new Error('sigue caído'));
    query.mockResolvedValueOnce({ rows: [fila({ intentos: MAX_INTENTOS - 1 })] });
    query.mockResolvedValue({ rowCount: 1 });

    const resultado = await procesarPendientes(enviar);

    const sql = query.mock.calls[1][0];
    expect(sql).toMatch(/estado = 'fallido'/);
    expect(sql).toMatch(/html = NULL/);
    expect(resultado).toMatchObject({ fallidos: 1 });
  });

  it('un rechazo permanente pasa directo a fallido sin gastar más intentos', async () => {
    const enviar = vi.fn().mockRejectedValue(Object.assign(new Error('buzón inexistente'), { responseCode: 550 }));
    query.mockResolvedValueOnce({ rows: [fila({ intentos: 1 })] });
    query.mockResolvedValue({ rowCount: 1 });

    const resultado = await procesarPendientes(enviar);

    expect(query.mock.calls[1][0]).toMatch(/estado = 'fallido'/);
    expect(resultado).toMatchObject({ fallidos: 1 });
  });

  it('un correo que falla no impide procesar el siguiente del lote', async () => {
    const enviar = vi.fn()
      .mockRejectedValueOnce(new Error('falla'))
      .mockResolvedValueOnce({ messageId: 'ok' });
    query.mockResolvedValueOnce({ rows: [fila({ id: 1 }), fila({ id: 2 })] });
    query.mockResolvedValue({ rowCount: 1 });

    const resultado = await procesarPendientes(enviar);

    expect(enviar).toHaveBeenCalledTimes(2);
    expect(resultado).toMatchObject({ enviados: 1, reprogramados: 1 });
  });
});
