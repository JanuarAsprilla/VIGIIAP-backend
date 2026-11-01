import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../src/config/database.js', () => ({ query: vi.fn() }));

import { query } from '../src/config/database.js';
import { getComparativa } from '../src/modules/analitica/analitica.service.js';

const DIA_MS = 24 * 60 * 60 * 1000;
const rango = { desde: new Date('2026-10-08T00:00:00.000Z'), hasta: new Date('2026-10-15T00:00:00.000Z') };

/** Cada período consulta primero vistas/sesiones/rebotadas y después las acciones. */
function mockPeriodo({ vistas, sesiones, rebotadas, acciones }) {
  query.mockResolvedValueOnce({ rows: [{ vistas, sesiones, rebotadas }] });
  query.mockResolvedValueOnce({ rows: [{ acciones }] });
}

beforeEach(() => vi.resetAllMocks());

describe('analitica.service → getComparativa()', () => {
  it('compara el rango con el período anterior de igual duración, que termina justo antes', async () => {
    mockPeriodo({ vistas: 0, sesiones: 0, rebotadas: 0, acciones: 0 });
    mockPeriodo({ vistas: 0, sesiones: 0, rebotadas: 0, acciones: 0 });

    const r = await getComparativa(rango);

    const duracion = rango.hasta.getTime() - rango.desde.getTime();
    const [, paramsAnterior] = query.mock.calls[2];
    expect(paramsAnterior[1].getTime()).toBe(rango.desde.getTime() - 1);
    expect(paramsAnterior[1].getTime() - paramsAnterior[0].getTime()).toBe(duracion);
    expect(r.anterior.hasta).toBe(new Date(rango.desde.getTime() - 1).toISOString());
    expect(r.actual.desde).toBe(rango.desde.toISOString());
  });

  it('calcula la variación porcentual de vistas, sesiones y acciones', async () => {
    mockPeriodo({ vistas: 150, sesiones: 60, rebotadas: 30, acciones: 20 });
    mockPeriodo({ vistas: 100, sesiones: 80, rebotadas: 20, acciones: 20 });

    const { actual, anterior, variacion } = await getComparativa(rango);

    expect(actual).toMatchObject({ vistas: 150, sesiones: 60, acciones: 20 });
    expect(anterior).toMatchObject({ vistas: 100, sesiones: 80, acciones: 20 });
    expect(variacion).toMatchObject({ vistas: 50, sesiones: -25, acciones: 0 });
  });

  it('la tasa de rebote se compara en puntos porcentuales, no en porcentaje del porcentaje', async () => {
    mockPeriodo({ vistas: 100, sesiones: 100, rebotadas: 60, acciones: 0 });
    mockPeriodo({ vistas: 100, sesiones: 100, rebotadas: 40, acciones: 0 });

    const { actual, anterior, variacion } = await getComparativa(rango);

    expect(actual.rebotePct).toBe(60);
    expect(anterior.rebotePct).toBe(40);
    expect(variacion.rebotePuntos).toBe(20);
  });

  it('si el período anterior estaba vacío, el crecimiento se informa como 100 % y sin datos como 0 %', async () => {
    mockPeriodo({ vistas: 10, sesiones: 5, rebotadas: 1, acciones: 0 });
    mockPeriodo({ vistas: 0, sesiones: 0, rebotadas: 0, acciones: 0 });

    const { variacion, anterior } = await getComparativa(rango);

    expect(variacion).toMatchObject({ vistas: 100, sesiones: 100, acciones: 0 });
    expect(anterior.rebotePct).toBe(0);
  });

  it('cada consulta excluye bots y el área de administración', async () => {
    mockPeriodo({ vistas: 0, sesiones: 0, rebotadas: 0, acciones: 0 });
    mockPeriodo({ vistas: 0, sesiones: 0, rebotadas: 0, acciones: 0 });

    await getComparativa(rango);

    expect(query.mock.calls[0][0]).toMatch(/es_bot = false/);
    expect(query.mock.calls[0][0]).toMatch(/es_area_admin = false/);
    expect(query.mock.calls[1][0]).toMatch(/es_bot = false/);
  });
});

describe('rango por defecto', () => {
  it('el período anterior nunca queda con duración cero', async () => {
    const instante = new Date('2026-10-15T00:00:00.000Z');
    mockPeriodo({ vistas: 0, sesiones: 0, rebotadas: 0, acciones: 0 });
    mockPeriodo({ vistas: 0, sesiones: 0, rebotadas: 0, acciones: 0 });

    const r = await getComparativa({ desde: new Date(instante.getTime() - DIA_MS), hasta: instante });

    expect(new Date(r.anterior.hasta) > new Date(r.anterior.desde)).toBe(true);
  });
});
