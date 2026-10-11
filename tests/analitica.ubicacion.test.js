import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../src/config/database.js', () => ({ query: vi.fn() }));

import { query } from '../src/config/database.js';
import { registrarPageview, getUbicaciones, getSesionesRecientes } from '../src/modules/analitica/analitica.service.js';
import { definirProveedorUbicacion } from '../src/utils/geolocalizacion.js';

const base = {
  sessionId: '11111111-1111-1111-1111-111111111111',
  ruta: '/mapas', titulo: 'Mapas', dispositivo: 'escritorio',
  navegador: 'Chrome', sistemaOperativo: 'Windows',
  referrerInicial: null, utmSource: null, utmMedium: null, utmCampaign: null,
  esAreaAdmin: false, userAgent: 'Mozilla/5.0 Chrome/120',
};

describe('registrarPageview() con ubicación', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    definirProveedorUbicacion(() => ({ country: 'CO', region: 'CHO', city: 'Quibdó' }));
  });
  afterEach(() => definirProveedorUbicacion(undefined));

  it('una sesión nueva guarda la IP normalizada y la ubicación aproximada', async () => {
    query.mockResolvedValue({ rows: [] });

    await registrarPageview({ ...base, ip: '::ffff:181.49.10.10' });

    const [sql, params] = query.mock.calls[1];
    expect(sql).toMatch(/ip, pais, departamento, ciudad/);
    expect(params.slice(9)).toEqual(['181.49.10.10', 'CO', 'Chocó', 'Quibdó']);
  });

  it('un bot no guarda IP ni ubicación', async () => {
    query.mockResolvedValue({ rows: [] });

    await registrarPageview({ ...base, userAgent: 'Googlebot/2.1', ip: '66.249.1.1' });

    expect(query.mock.calls[1][1].slice(9)).toEqual([null, null, null, null]);
  });

  it('sin IP la sesión se crea igual, sin ubicación', async () => {
    query.mockResolvedValue({ rows: [] });
    definirProveedorUbicacion(() => null);

    await registrarPageview(base);

    expect(query.mock.calls[1][1].slice(9)).toEqual([null, null, null, null]);
  });

  it('una sesión existente no vuelve a guardar la IP', async () => {
    query.mockResolvedValueOnce({ rows: [{ id: base.sessionId }] }).mockResolvedValue({ rows: [] });

    await registrarPageview({ ...base, ip: '181.49.10.10' });

    expect(query.mock.calls[1][0]).toMatch(/^UPDATE analytics_sessions SET ultima_actividad_en/);
  });
});

describe('getUbicaciones()', () => {
  beforeEach(() => vi.resetAllMocks());

  it('agrupa por país y departamento y cuenta las sesiones sin ubicación', async () => {
    query
      .mockResolvedValueOnce({ rows: [{ pais: 'CO', sesiones: 9 }] })
      .mockResolvedValueOnce({ rows: [{ departamento: 'Chocó', sesiones: 5 }] })
      .mockResolvedValueOnce({ rows: [{ sesiones: 2 }] });

    const r = await getUbicaciones({ desde: new Date('2026-01-01'), hasta: new Date('2026-02-01') });

    expect(r).toEqual({
      paises: [{ pais: 'CO', sesiones: 9 }],
      departamentos: [{ departamento: 'Chocó', sesiones: 5 }],
      sinUbicacion: 2,
    });
    expect(query.mock.calls[0][0]).toMatch(/es_bot = false/);
  });
});

describe('getSesionesRecientes()', () => {
  beforeEach(() => vi.resetAllMocks());

  it('devuelve las últimas sesiones que no son bots', async () => {
    query.mockResolvedValueOnce({ rows: [{ id: 's1', ip: '1.2.3.4' }] });

    expect(await getSesionesRecientes()).toEqual([{ id: 's1', ip: '1.2.3.4' }]);
    expect(query.mock.calls[0][0]).toMatch(/es_bot = false[\s\S]*ORDER BY primera_visita_en DESC LIMIT \$1/);
    expect(query.mock.calls[0][1]).toEqual([50]);
  });
});
