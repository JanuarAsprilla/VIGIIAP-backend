import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../src/config/database.js', () => ({ query: vi.fn() }));
vi.mock('../src/utils/logger.js', () => ({
  default: { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() },
}));

import { query } from '../src/config/database.js';

const S1 = '11111111-1111-4111-8111-111111111111';
const S2 = '22222222-2222-4222-8222-222222222222';
const PV = {
  sessionId: S1, ruta: '/mapas', titulo: 'Mapas', dispositivo: 'escritorio', navegador: 'Chrome', sistemaOperativo: 'Windows',
  referrerInicial: null, utmSource: null, utmMedium: null, utmCampaign: null, esAreaAdmin: false,
  userAgent: 'Mozilla/5.0 Chrome/120', ip: '190.1.2.3',
};

async function cargar() {
  vi.resetModules();
  return import('../src/modules/analitica/analitica.service.js');
}

const buscar = (patron) => query.mock.calls.find(([sql]) => patron.test(sql));

describe('analitica por lotes (ANALITICA_COLA=true)', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    process.env.ANALITICA_COLA = 'true';
    process.env.ANALITICA_COLA_INTERVALO_MS = '3600000';
  });
  afterEach(() => {
    delete process.env.ANALITICA_COLA;
    delete process.env.ANALITICA_COLA_INTERVALO_MS;
    delete process.env.ANALITICA_COLA_TOPE;
    delete process.env.ANALITICA_COLA_LOTE;
  });

  it('el beacon solo encola: no toca la base de datos en la petición', async () => {
    const svc = await cargar();
    await svc.registrarPageview(PV);
    await svc.registrarEvento({ sessionId: S1, nombre: 'descarga_mapa' });
    expect(query).not.toHaveBeenCalled();
    expect(svc.estadisticasColaAnalitica().pendientes).toBe(2);
    await svc.vaciarColaAnalitica();
  });

  it('al vaciar escribe sesiones nuevas, vistas y eventos en INSERT multifila', async () => {
    query.mockResolvedValueOnce({ rows: [{ id: S2 }] });
    query.mockResolvedValue({ rows: [] });
    const svc = await cargar();
    await svc.registrarPageview(PV);
    await svc.registrarPageview({ ...PV, ruta: '/documentos' });
    await svc.registrarPageview({ ...PV, sessionId: S2 });
    await svc.registrarEvento({ sessionId: S1, nombre: 'abrir_geovisor', recurso: 'rio' });
    await svc.vaciarColaAnalitica();

    expect(query.mock.calls[0][0]).toMatch(/SELECT id FROM analytics_sessions WHERE id = ANY/);
    const insertSesiones = buscar(/INSERT INTO analytics_sessions/);
    expect(insertSesiones[1][0]).toBe(S1);
    expect(insertSesiones[1]).toHaveLength(15);
    expect(buscar(/UPDATE analytics_sessions SET ultima_actividad_en = NOW\(\)/)).toBeTruthy();

    const insertVistas = buscar(/INSERT INTO analytics_pageviews/);
    expect(insertVistas[0].match(/\(\$\d+(, \$\d+){5}\)/g)).toHaveLength(3);
    expect([insertVistas[1][3], insertVistas[1][9], insertVistas[1][15]]).toEqual([true, false, false]);

    const insertEventos = buscar(/INSERT INTO analytics_eventos/);
    expect(insertEventos[0]).toMatch(/es_bot = false/);
    expect(insertEventos[1].slice(0, 4)).toEqual([S1, 'abrir_geovisor', 'rio', null]);
  });

  it('conserva la redacción de tokens y no guarda la IP de los bots', async () => {
    query.mockResolvedValue({ rows: [] });
    const svc = await cargar();
    const token = 'a'.repeat(64);
    await svc.registrarPageview({ ...PV, ruta: `/reset-password/${token}?x=1`, referrerInicial: `https://x.test/verificar-email/${token}` });
    await svc.registrarPageview({ ...PV, sessionId: S2, userAgent: 'Googlebot/2.1' });
    await svc.vaciarColaAnalitica();

    expect(JSON.stringify(query.mock.calls.map(([, p]) => p))).not.toContain(token);
    const filaBot = buscar(/INSERT INTO analytics_sessions/)[1].slice(15, 30);
    expect(filaBot[8]).toBe(true);
    expect(filaBot[9]).toBeNull();
  });

  it('un fallo de la base al vaciar no lanza ni tumba el proceso', async () => {
    query.mockRejectedValue(new Error('conexión caída'));
    const svc = await cargar();
    await svc.registrarPageview(PV);
    await expect(svc.vaciarColaAnalitica()).resolves.toBeUndefined();
    expect(svc.estadisticasColaAnalitica().perdidosPorError).toBe(1);
  });

  it('respeta ANALITICA_COLA_TOPE y descarta los más antiguos', async () => {
    process.env.ANALITICA_COLA_TOPE = '3';
    process.env.ANALITICA_COLA_LOTE = '1000';
    const svc = await cargar();
    for (let i = 0; i < 5; i += 1) await svc.registrarEvento({ sessionId: S1, nombre: 'descarga_mapa', recurso: `r${i}` });
    expect(svc.estadisticasColaAnalitica()).toMatchObject({ pendientes: 3, descartados: 2 });
    query.mockResolvedValue({ rows: [] });
    await svc.vaciarColaAnalitica();
    const [, params] = buscar(/INSERT INTO analytics_eventos/);
    expect(params.filter((_, i) => i % 5 === 2)).toEqual(['r2', 'r3', 'r4']);
  });
});

describe('analitica por lotes apagada (por defecto)', () => {
  it('sin ANALITICA_COLA se escribe directo como antes', async () => {
    vi.resetAllMocks();
    delete process.env.ANALITICA_COLA;
    query.mockResolvedValue({ rows: [] });
    const svc = await cargar();
    await svc.registrarPageview(PV);
    expect(query).toHaveBeenCalledTimes(3);
    expect(svc.estadisticasColaAnalitica()).toBeNull();
  });
});
