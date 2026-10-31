import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../src/config/database.js', () => ({ query: vi.fn() }));

import { query } from '../src/config/database.js';
import { EMBUDOS, construirConsultaEmbudo } from '../src/modules/analitica/embudos.js';
import { getEmbudos, getFlujoNavegacion } from '../src/modules/analitica/analitica.service.js';

const rango = { desde: new Date('2026-10-01'), hasta: new Date('2026-10-15') };

beforeEach(() => vi.resetAllMocks());

describe('catálogo de embudos', () => {
  it('cada embudo tiene entre 2 y 5 pasos, y cada paso es una ruta o un evento del catálogo', () => {
    for (const [id, embudo] of Object.entries(EMBUDOS)) {
      expect(embudo.pasos.length, id).toBeGreaterThanOrEqual(2);
      expect(embudo.pasos.length, id).toBeLessThanOrEqual(5);
      for (const paso of embudo.pasos) {
        expect(Boolean(paso.ruta) !== Boolean(paso.evento), `${id}: un paso es ruta o evento`).toBe(true);
        expect(paso.etiqueta, id).toBeTruthy();
      }
    }
  });
});

describe('construirConsultaEmbudo()', () => {
  const pasos = [
    { etiqueta: 'Portada', ruta: '/' },
    { etiqueta: 'Mapas', ruta: '/mapas' },
    { etiqueta: 'Descarga', evento: 'descarga_mapa' },
  ];

  it('encadena un paso tras otro: cada uno debe ocurrir después del anterior', () => {
    const { sql } = construirConsultaEmbudo(pasos);

    expect(sql).toMatch(/WITH\s+p1 AS/);
    expect(sql).toMatch(/p2 AS[\s\S]*JOIN p1 ON p1\.session_id = m\.session_id AND m\.t > p1\.t/);
    expect(sql).toMatch(/p3 AS[\s\S]*JOIN p2 ON p2\.session_id = m\.session_id AND m\.t > p2\.t/);
  });

  it('no concatena valores en el SQL: rutas y eventos viajan como parámetros', () => {
    const { sql, params } = construirConsultaEmbudo(pasos);

    expect(sql).not.toContain('descarga_mapa');
    expect(sql).not.toContain("'/mapas'");
    expect(params).toEqual(['/', '/mapas', 'descarga_mapa']);
  });

  it('excluye bots y el área de administración, y acota por el rango de fechas', () => {
    const { sql } = construirConsultaEmbudo(pasos);

    expect(sql).toMatch(/es_bot = false/);
    expect(sql).toMatch(/es_area_admin = false/);
    expect(sql).toMatch(/BETWEEN \$1 AND \$2/);
  });

  it('rechaza un embudo con menos de dos pasos', () => {
    expect(() => construirConsultaEmbudo([pasos[0]])).toThrow();
  });
});

describe('analitica.service → getEmbudos()', () => {
  it('devuelve por embudo las sesiones de cada paso con su porcentaje', async () => {
    const ids = Object.keys(EMBUDOS);
    ids.forEach(() => {
      query.mockResolvedValueOnce({ rows: [{ c1: 200, c2: 100, c3: 25, c4: 0, c5: 0 }] });
    });

    const resultado = await getEmbudos(rango);

    expect(resultado).toHaveLength(ids.length);
    const primero = resultado[0];
    expect(primero.id).toBe(ids[0]);
    expect(primero.pasos[0]).toMatchObject({ sesiones: 200, pctDelInicio: 100 });
    expect(primero.pasos[1]).toMatchObject({ sesiones: 100, pctDelAnterior: 50, pctDelInicio: 50 });
    expect(primero.pasos[2]).toMatchObject({ sesiones: 25, pctDelAnterior: 25, pctDelInicio: 13 });
  });

  it('sin sesiones en el primer paso no divide entre cero', async () => {
    Object.keys(EMBUDOS).forEach(() => {
      query.mockResolvedValueOnce({ rows: [{ c1: 0, c2: 0, c3: 0, c4: 0, c5: 0 }] });
    });

    const [primero] = await getEmbudos(rango);

    expect(primero.pasos.every((p) => p.pctDelAnterior === 0 && p.pctDelInicio === 0)).toBe(true);
  });
});

describe('analitica.service → getFlujoNavegacion()', () => {
  it('lista las transiciones más frecuentes entre páginas, sin bots ni administración', async () => {
    query.mockResolvedValueOnce({ rows: [{ desde: '/', hacia: '/mapas', veces: 40 }] });

    const flujo = await getFlujoNavegacion({ ...rango, limit: 5 });

    expect(flujo).toEqual([{ desde: '/', hacia: '/mapas', veces: 40 }]);
    const [sql, params] = query.mock.calls[0];
    expect(sql).toMatch(/LEAD\(/);
    expect(sql).toMatch(/es_bot = false/);
    expect(sql).toMatch(/es_area_admin = false/);
    expect(params).toEqual([rango.desde, rango.hasta, 5]);
  });
});
