import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../src/config/database.js', () => ({ query: vi.fn() }));

import { query } from '../src/config/database.js';
import {
  EVENTOS_PERMITIDOS, registrarEvento, getEventosTop, getTiempoReal,
} from '../src/modules/analitica/analitica.service.js';

const SESION = '11111111-1111-4111-8111-111111111111';

beforeEach(() => vi.resetAllMocks());

describe('analitica.service → registrarEvento()', () => {
  it('guarda el evento cuando la sesión existe y no es un bot', async () => {
    query.mockResolvedValueOnce({ rows: [{ es_bot: false }] });
    query.mockResolvedValueOnce({ rows: [] });

    const guardado = await registrarEvento({ sessionId: SESION, nombre: 'descarga_mapa', recurso: 'rio-atrato', ruta: '/mapas/rio-atrato' });

    expect(guardado).toBe(true);
    const [sql, params] = query.mock.calls[1];
    expect(sql).toMatch(/INSERT INTO analytics_eventos/);
    expect(params).toEqual([SESION, 'descarga_mapa', 'rio-atrato', '/mapas/rio-atrato']);
  });

  it('ignora el evento si la sesión no existe (el pageview la crea primero)', async () => {
    query.mockResolvedValueOnce({ rows: [] });

    expect(await registrarEvento({ sessionId: SESION, nombre: 'abrir_geovisor' })).toBe(false);
    expect(query).toHaveBeenCalledTimes(1);
  });

  it('ignora el evento de una sesión marcada como bot', async () => {
    query.mockResolvedValueOnce({ rows: [{ es_bot: true }] });

    expect(await registrarEvento({ sessionId: SESION, nombre: 'abrir_geovisor' })).toBe(false);
    expect(query).toHaveBeenCalledTimes(1);
  });

  it('el catálogo es cerrado y contiene los eventos clave de la plataforma', () => {
    expect(EVENTOS_PERMITIDOS).toEqual(expect.arrayContaining([
      'descarga_mapa', 'descarga_documento', 'abrir_geovisor', 'usar_herramienta', 'buscar',
    ]));
  });
});

describe('analitica.service → getEventosTop()', () => {
  it('devuelve totales por evento y los recursos más frecuentes, sin bots', async () => {
    query.mockResolvedValueOnce({ rows: [{ nombre: 'descarga_mapa', total: 12, sesiones: 9 }] });
    query.mockResolvedValueOnce({ rows: [{ nombre: 'descarga_mapa', recurso: 'rio-atrato', total: 5 }] });

    const resultado = await getEventosTop({ desde: new Date('2026-10-01'), hasta: new Date('2026-10-15') });

    expect(resultado.eventos).toEqual([{ nombre: 'descarga_mapa', total: 12, sesiones: 9 }]);
    expect(resultado.recursos).toEqual([{ nombre: 'descarga_mapa', recurso: 'rio-atrato', total: 5 }]);
    expect(query.mock.calls[0][0]).toMatch(/es_bot = false/);
  });
});

describe('analitica.service → getTiempoReal()', () => {
  it('cuenta las sesiones activas en los últimos minutos y sus páginas actuales', async () => {
    query.mockResolvedValueOnce({ rows: [{ activos: 7 }] });
    query.mockResolvedValueOnce({ rows: [{ ruta: '/mapas', visitantes: 4 }] });

    const resultado = await getTiempoReal();

    expect(resultado).toEqual({ ventanaMin: 5, visitantesActivos: 7, paginasActuales: [{ ruta: '/mapas', visitantes: 4 }] });
    expect(query.mock.calls[0][0]).toMatch(/es_bot = false/);
    expect(query.mock.calls[0][0]).toMatch(/ultima_actividad_en >= NOW\(\) - /);
  });

  it('sin actividad devuelve cero y lista vacía', async () => {
    query.mockResolvedValueOnce({ rows: [{ activos: 0 }] });
    query.mockResolvedValueOnce({ rows: [] });

    expect(await getTiempoReal()).toMatchObject({ visitantesActivos: 0, paginasActuales: [] });
  });
});
