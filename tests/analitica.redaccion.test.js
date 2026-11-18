import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../src/config/database.js', () => ({ query: vi.fn() }));

import { query } from '../src/config/database.js';
import { redactarUrl } from '../src/utils/redactarUrl.js';
import { redactarRuta, fusionarRutas } from '../src/modules/analitica/redaccion.js';
import {
  registrarPageview, registrarEvento, getPaginasTop, getTiempoReal, getEntradaSalida, getFlujoNavegacion,
} from '../src/modules/analitica/analitica.service.js';

const TOKEN = 'ab12'.repeat(16);
const SESION = '11111111-1111-1111-1111-111111111111';

describe('redactarUrl() — tokens y parámetros extra', () => {
  it('oculta cualquier segmento tras reset-password / verificar-email y el parámetro token', () => {
    expect(redactarUrl('/reset-password/abc-DEF_123')).toBe('/reset-password/[REDACTED]');
    expect(redactarUrl('/x?token=secreto&a=1')).toBe('/x?token=[REDACTED]&a=1');
  });
});

describe('redactarRuta()', () => {
  it('sustituye el token y descarta la consulta y el fragmento', () => {
    expect(redactarRuta(`/reset-password/${TOKEN}?x=1#y`)).toBe('/reset-password/[REDACTED]');
    expect(redactarRuta('/mapas')).toBe('/mapas');
    expect(redactarRuta(null)).toBeNull();
  });
});

describe('fusionarRutas()', () => {
  it('redacta, suma las filas que quedan iguales y ordena sin mutar la entrada', () => {
    const entrada = [
      { ruta: `/reset-password/${TOKEN}`, vistas: 1 },
      { ruta: '/mapas', vistas: 3 },
      { ruta: `/reset-password/${'cd34'.repeat(16)}`, vistas: 4 },
    ];
    const copia = JSON.parse(JSON.stringify(entrada));
    const salida = fusionarRutas(entrada, ['ruta'], 'vistas');
    expect(salida).toEqual([{ ruta: '/reset-password/[REDACTED]', vistas: 5 }, { ruta: '/mapas', vistas: 3 }]);
    expect(entrada).toEqual(copia);
  });
});

describe('analitica.service — no guarda ni devuelve tokens', () => {
  beforeEach(() => vi.resetAllMocks());

  it('registrarPageview guarda ruta, título y referrer redactados', async () => {
    query.mockResolvedValue({ rows: [{ id: SESION }] });
    await registrarPageview({
      sessionId: SESION, ruta: `/reset-password/${TOKEN}`, titulo: `Restablecer /reset-password/${TOKEN}`,
      dispositivo: 'escritorio', referrerInicial: `https://app.test/verificar-email/${TOKEN}?token=zzz`,
      esAreaAdmin: false, userAgent: 'Mozilla/5.0', ip: '1.1.1.1',
    });
    const todos = JSON.stringify(query.mock.calls);
    expect(todos).not.toContain(TOKEN);
    expect(todos).not.toContain('zzz');
    const insertPv = query.mock.calls.find(([sql]) => /INSERT INTO analytics_pageviews/.test(sql));
    expect(insertPv[1][1]).toBe('/reset-password/[REDACTED]');
  });

  it('registrarEvento guarda la ruta redactada', async () => {
    query.mockResolvedValue({ rows: [{ id: SESION, es_bot: false }] });
    await registrarEvento({ sessionId: SESION, nombre: 'buscar', recurso: null, ruta: `/reset-password/${TOKEN}` });
    expect(JSON.stringify(query.mock.calls)).not.toContain(TOKEN);
  });

  it('los paneles redactan y fusionan filas ya guardadas con token', async () => {
    const rango = { desde: new Date('2026-01-01'), hasta: new Date('2026-01-02') };
    const sucia = `/reset-password/${TOKEN}`;

    query.mockResolvedValueOnce({ rows: [{ ruta: sucia, vistas: 2, visitantes: 1 }] });
    expect(await getPaginasTop({ ...rango, limit: 71 })).toEqual([{ ruta: '/reset-password/[REDACTED]', vistas: 2, visitantes: 1 }]);

    query.mockResolvedValueOnce({ rows: [{ activos: 1 }] }).mockResolvedValueOnce({ rows: [{ ruta: sucia, visitantes: 1 }] });
    expect((await getTiempoReal()).paginasActuales).toEqual([{ ruta: '/reset-password/[REDACTED]', visitantes: 1 }]);

    query.mockResolvedValueOnce({ rows: [{ ruta: sucia, veces: 1 }] }).mockResolvedValueOnce({ rows: [{ ruta: sucia, veces: 1 }] });
    const es = await getEntradaSalida({ ...rango, limit: 71 });
    expect(JSON.stringify(es)).not.toContain(TOKEN);

    query.mockResolvedValueOnce({ rows: [{ desde: '/', hacia: sucia, veces: 1 }] });
    expect(JSON.stringify(await getFlujoNavegacion({ ...rango, limit: 71 }))).not.toContain(TOKEN);
  });
});
