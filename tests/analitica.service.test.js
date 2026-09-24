/**
 * Tests unitarios para analitica.service.js
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../src/config/database.js', () => ({ query: vi.fn() }));

import { query } from '../src/config/database.js';
import {
  esBot, registrarPageview, getResumen, getPaginasTop,
  getDispositivos, getFuentesTrafico, getEntradaSalida,
} from '../src/modules/analitica/analitica.service.js';

describe('analitica.service → esBot()', () => {
  it('detecta user-agents conocidos de bots/crawlers', () => {
    expect(esBot('Mozilla/5.0 (compatible; Googlebot/2.1)')).toBe(true);
    expect(esBot('facebookexternalhit/1.1')).toBe(true);
    expect(esBot('Pingdom.com_bot_version_1.4')).toBe(true);
  });

  it('no marca como bot un user-agent normal de navegador', () => {
    expect(esBot('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120')).toBe(false);
  });

  it('marca como bot cuando no hay user-agent', () => {
    expect(esBot(undefined)).toBe(true);
    expect(esBot('')).toBe(true);
  });
});

describe('analitica.service → registrarPageview()', () => {
  beforeEach(() => vi.resetAllMocks());

  const base = {
    sessionId: '11111111-1111-1111-1111-111111111111',
    ruta: '/mapas', titulo: 'Mapas', dispositivo: 'escritorio',
    navegador: 'Chrome', sistemaOperativo: 'Windows',
    referrerInicial: null, utmSource: null, utmMedium: null, utmCampaign: null,
    esAreaAdmin: false, userAgent: 'Mozilla/5.0 Chrome/120',
  };

  it('sesión nueva: inserta en analytics_sessions y marca es_entrada=true', async () => {
    query.mockResolvedValueOnce({ rows: [] }); // SELECT existente → no existe
    query.mockResolvedValueOnce({ rows: [] }); // INSERT sessions
    query.mockResolvedValueOnce({ rows: [] }); // INSERT pageviews

    await registrarPageview(base);

    expect(query).toHaveBeenCalledTimes(3);
    const [sqlInsertSession, paramsSession] = query.mock.calls[1];
    expect(sqlInsertSession).toMatch(/INSERT INTO analytics_sessions/);
    expect(paramsSession[0]).toBe(base.sessionId);
    expect(paramsSession[8]).toBe(false); // es_bot

    const [sqlInsertPageview, paramsPageview] = query.mock.calls[2];
    expect(sqlInsertPageview).toMatch(/INSERT INTO analytics_pageviews/);
    expect(paramsPageview).toEqual([base.sessionId, base.ruta, base.titulo, true, false]);
  });

  it('sesión existente: solo actualiza ultima_actividad_en, es_entrada=false', async () => {
    query.mockResolvedValueOnce({ rows: [{ id: base.sessionId }] }); // ya existe
    query.mockResolvedValueOnce({ rows: [] }); // UPDATE sessions
    query.mockResolvedValueOnce({ rows: [] }); // INSERT pageviews

    await registrarPageview(base);

    const [sqlUpdate] = query.mock.calls[1];
    expect(sqlUpdate).toMatch(/UPDATE analytics_sessions SET ultima_actividad_en = NOW\(\)/);
    const [, paramsPageview] = query.mock.calls[2];
    expect(paramsPageview[3]).toBe(false); // es_entrada
  });

  it('user-agent de bot se guarda con es_bot=true en la sesión nueva', async () => {
    query.mockResolvedValueOnce({ rows: [] });
    query.mockResolvedValueOnce({ rows: [] });
    query.mockResolvedValueOnce({ rows: [] });

    await registrarPageview({ ...base, userAgent: 'Googlebot/2.1' });

    const [, paramsSession] = query.mock.calls[1];
    expect(paramsSession[8]).toBe(true);
  });

  it('nunca envía IP ni identidad de usuario en los parámetros del INSERT', async () => {
    query.mockResolvedValueOnce({ rows: [] });
    query.mockResolvedValueOnce({ rows: [] });
    query.mockResolvedValueOnce({ rows: [] });

    await registrarPageview(base);

    const todosLosParams = query.mock.calls.flatMap(([, params]) => params ?? []);
    expect(todosLosParams).not.toContain(expect.stringMatching(/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/));
  });
});

describe('analitica.service → getResumen()', () => {
  beforeEach(() => vi.resetAllMocks());

  it('excluye tráfico de bots en las tres consultas', async () => {
    query.mockResolvedValueOnce({ rows: [] }); // pageviews
    query.mockResolvedValueOnce({ rows: [] }); // sesiones
    query.mockResolvedValueOnce({ rows: [{ total_sesiones: 0, sesiones_una_pagina: 0, duracion_prom_seg: null }] });

    await getResumen();

    expect(query.mock.calls[0][0]).toMatch(/s\.es_bot = false/);
    expect(query.mock.calls[1][0]).toMatch(/es_bot = false/);
    expect(query.mock.calls[2][0]).toMatch(/s\.es_bot = false/);
  });

  it('calcula tasa de rebote como sesiones de 1 página / total', async () => {
    query.mockResolvedValueOnce({ rows: [] });
    query.mockResolvedValueOnce({ rows: [] });
    query.mockResolvedValueOnce({ rows: [{ total_sesiones: 10, sesiones_una_pagina: 3, duracion_prom_seg: '45.5' }] });

    const result = await getResumen();

    expect(result.tasaRebotePct).toBe(30);
    expect(result.duracionPromedioSeg).toBe(46);
  });

  it('tasa de rebote es 0 cuando no hay sesiones (evita división por cero)', async () => {
    query.mockResolvedValueOnce({ rows: [] });
    query.mockResolvedValueOnce({ rows: [] });
    query.mockResolvedValueOnce({ rows: [{ total_sesiones: 0, sesiones_una_pagina: 0, duracion_prom_seg: null }] });

    const result = await getResumen();
    expect(result.tasaRebotePct).toBe(0);
    expect(result.duracionPromedioSeg).toBe(0);
  });

  it('retorna serie de tendencia con semanaActual/semanaAnterior/deltaPct para páginas vistas y visitantes', async () => {
    query.mockResolvedValueOnce({ rows: [] });
    query.mockResolvedValueOnce({ rows: [] });
    query.mockResolvedValueOnce({ rows: [{ total_sesiones: 0, sesiones_una_pagina: 0, duracion_prom_seg: null }] });

    const result = await getResumen();

    expect(result.paginasVistas).toEqual(
      expect.objectContaining({ serie7: expect.any(Array), semanaActual: 0, semanaAnterior: 0, deltaPct: 0 }),
    );
    expect(result.paginasVistas.serie7).toHaveLength(7);
    expect(result.visitantes.serie7).toHaveLength(7);
  });
});

describe('analitica.service → getPaginasTop()', () => {
  beforeEach(() => vi.resetAllMocks());

  it('excluye área admin y bots, respeta el límite', async () => {
    query.mockResolvedValueOnce({ rows: [{ ruta: '/mapas', vistas: 10, visitantes: 5 }] });
    const desde = new Date('2026-01-01');
    const hasta = new Date('2026-01-15');
    const result = await getPaginasTop({ desde, hasta, limit: 5 });

    expect(result).toEqual([{ ruta: '/mapas', vistas: 10, visitantes: 5 }]);
    const [sql, params] = query.mock.calls[0];
    expect(sql).toMatch(/es_bot = false/);
    expect(sql).toMatch(/es_area_admin = false/);
    expect(params).toEqual([desde, hasta, 5]);
  });

  it('usa límite por defecto de 10 si no se especifica', async () => {
    query.mockResolvedValueOnce({ rows: [] });
    await getPaginasTop({ desde: new Date(), hasta: new Date() });
    const [, params] = query.mock.calls[0];
    expect(params[2]).toBe(10);
  });
});

describe('analitica.service → getDispositivos()', () => {
  beforeEach(() => vi.resetAllMocks());

  it('agrupa por dispositivo excluyendo bots', async () => {
    query.mockResolvedValueOnce({ rows: [{ dispositivo: 'movil', sesiones: 7 }] });
    const result = await getDispositivos({ desde: new Date(), hasta: new Date() });
    expect(result).toEqual([{ dispositivo: 'movil', sesiones: 7 }]);
    expect(query.mock.calls[0][0]).toMatch(/es_bot = false/);
  });
});

describe('analitica.service → getFuentesTrafico()', () => {
  beforeEach(() => vi.resetAllMocks());

  it('sin referrer, categoriza como Directo', async () => {
    query.mockResolvedValueOnce({ rows: [{ referrer_inicial: null, sesiones: 4 }] });
    const result = await getFuentesTrafico({ desde: new Date(), hasta: new Date() });
    expect(result).toEqual([{ fuente: 'Directo', sesiones: 4 }]);
  });

  it('referrer de google.com se categoriza como Buscadores', async () => {
    query.mockResolvedValueOnce({ rows: [{ referrer_inicial: 'https://www.google.com/search?q=x', sesiones: 3 }] });
    const result = await getFuentesTrafico({ desde: new Date(), hasta: new Date() });
    expect(result).toEqual([{ fuente: 'Buscadores', sesiones: 3 }]);
  });

  it('referrer de facebook.com se categoriza como Redes sociales', async () => {
    query.mockResolvedValueOnce({ rows: [{ referrer_inicial: 'https://facebook.com/', sesiones: 2 }] });
    const result = await getFuentesTrafico({ desde: new Date(), hasta: new Date() });
    expect(result).toEqual([{ fuente: 'Redes sociales', sesiones: 2 }]);
  });

  it('referrer de un dominio desconocido se categoriza como Otros sitios', async () => {
    query.mockResolvedValueOnce({ rows: [{ referrer_inicial: 'https://algun-blog-externo.co/', sesiones: 1 }] });
    const result = await getFuentesTrafico({ desde: new Date(), hasta: new Date() });
    expect(result).toEqual([{ fuente: 'Otros sitios', sesiones: 1 }]);
  });

  it('agrupa múltiples filas de la misma categoría en una sola suma', async () => {
    query.mockResolvedValueOnce({
      rows: [
        { referrer_inicial: 'https://google.com/', sesiones: 3 },
        { referrer_inicial: 'https://bing.com/', sesiones: 2 },
      ],
    });
    const result = await getFuentesTrafico({ desde: new Date(), hasta: new Date() });
    expect(result).toEqual([{ fuente: 'Buscadores', sesiones: 5 }]);
  });

  it('ordena de mayor a menor cantidad de sesiones', async () => {
    query.mockResolvedValueOnce({
      rows: [
        { referrer_inicial: null, sesiones: 1 },
        { referrer_inicial: 'https://google.com/', sesiones: 9 },
      ],
    });
    const result = await getFuentesTrafico({ desde: new Date(), hasta: new Date() });
    expect(result[0]).toEqual({ fuente: 'Buscadores', sesiones: 9 });
  });
});

describe('analitica.service → getEntradaSalida()', () => {
  beforeEach(() => vi.resetAllMocks());

  it('retorna páginas de entrada y de salida, excluyendo bots y área admin', async () => {
    query.mockResolvedValueOnce({ rows: [{ ruta: '/', veces: 20 }] });
    query.mockResolvedValueOnce({ rows: [{ ruta: '/mapas', veces: 8 }] });

    const result = await getEntradaSalida({ desde: new Date(), hasta: new Date(), limit: 5 });

    expect(result.entradas).toEqual([{ ruta: '/', veces: 20 }]);
    expect(result.salidas).toEqual([{ ruta: '/mapas', veces: 8 }]);
    expect(query.mock.calls[0][0]).toMatch(/es_entrada = true/);
    expect(query.mock.calls[0][0]).toMatch(/es_bot = false/);
    expect(query.mock.calls[1][0]).toMatch(/DISTINCT ON \(p\.session_id\)/);
  });
});
