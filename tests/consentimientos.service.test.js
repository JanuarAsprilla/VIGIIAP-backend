import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../src/config/database.js', () => ({ query: vi.fn() }));

import { query } from '../src/config/database.js';
import {
  registrarConsentimiento, listarConsentimientos, VERSION_POLITICA,
} from '../src/modules/privacidad/consentimientos.service.js';

describe('registrarConsentimiento()', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    query.mockResolvedValue({ rows: [{ id: 'c1', creado_en: '2026-11-05T10:00:00Z' }] });
  });

  it('guarda quién aceptó, qué versión de la política, de dónde y desde qué IP', async () => {
    const r = await registrarConsentimiento({
      usuarioId: 'u1', tipo: 'tratamiento_datos', origen: 'registro', ip: '10.0.0.5', userAgent: 'Mozilla/5.0',
    });

    expect(r).toEqual({ id: 'c1', creado_en: '2026-11-05T10:00:00Z' });
    expect(query.mock.calls[0][0]).toMatch(/INSERT INTO consentimientos/);
    expect(query.mock.calls[0][1]).toEqual(['u1', 'tratamiento_datos', VERSION_POLITICA, 'registro', true, '10.0.0.5', 'Mozilla/5.0']);
  });

  it('registra también una revocación (aceptado: false) como fila nueva', async () => {
    await registrarConsentimiento({ usuarioId: 'u1', tipo: 'analitica_persistente', origen: 'banner', aceptado: false });
    expect(query.mock.calls[0][1][4]).toBe(false);
  });

  it('descarta una IP con formato inválido en vez de hacer fallar el INSERT (la columna es INET)', async () => {
    await registrarConsentimiento({ usuarioId: 'u1', tipo: 'terminos', origen: 'registro', ip: "1.1.1.1'; DROP TABLE x;--" });
    expect(query.mock.calls[0][1][5]).toBeNull();
  });

  it('acepta una IPv4 mapeada en IPv6 tal como la entrega Express', async () => {
    await registrarConsentimiento({ usuarioId: 'u1', tipo: 'terminos', origen: 'registro', ip: '::ffff:10.0.0.5' });
    expect(query.mock.calls[0][1][5]).toBe('::ffff:10.0.0.5');
  });

  it('recorta un user-agent excesivo', async () => {
    await registrarConsentimiento({ usuarioId: 'u1', tipo: 'terminos', origen: 'registro', userAgent: 'x'.repeat(1000) });
    expect(query.mock.calls[0][1][6]).toHaveLength(300);
  });

  it.each([
    [{ tipo: 'otro', origen: 'registro' }, /Tipo de consentimiento/],
    [{ tipo: 'terminos', origen: 'otro' }, /Origen de consentimiento/],
  ])('rechaza valores fuera del catálogo %j sin tocar la base', async (datos, mensaje) => {
    await expect(registrarConsentimiento({ usuarioId: 'u1', ...datos })).rejects.toThrow(mensaje);
    expect(query).not.toHaveBeenCalled();
  });

  it('permite registrar sin usuario (p.ej. visitante que aún no tiene cuenta)', async () => {
    await registrarConsentimiento({ tipo: 'analitica_persistente', origen: 'banner' });
    expect(query.mock.calls[0][1][0]).toBeNull();
  });
});

describe('listarConsentimientos()', () => {
  it('devuelve el historial de la persona, el más reciente primero', async () => {
    vi.resetAllMocks();
    query.mockResolvedValue({ rows: [{ tipo: 'terminos' }] });
    expect(await listarConsentimientos('u1')).toEqual([{ tipo: 'terminos' }]);
    expect(query.mock.calls[0][0]).toMatch(/ORDER BY creado_en DESC/);
    expect(query.mock.calls[0][1]).toEqual(['u1']);
  });
});
