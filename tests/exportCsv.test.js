import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../src/config/database.js', () => ({ query: vi.fn() }));
vi.mock('../src/utils/logger.js', () => ({ default: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));

import { query } from '../src/config/database.js';
import { celdaCsv, lineaCsv, transmitirCsv } from '../src/modules/admin/exportCsv.js';

function mockRes({ buffer = true } = {}) {
  const res = {
    cuerpo: '', destroyed: false, writableEnded: false,
    setHeader: vi.fn(),
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
    write: vi.fn((s) => { res.cuerpo += s; return buffer; }),
    end: vi.fn(() => { res.writableEnded = true; }),
    once: vi.fn((ev, fn) => { if (ev === 'drain') setImmediate(fn); }),
    off: vi.fn(),
    destroy: vi.fn(() => { res.destroyed = true; }),
  };
  return res;
}

const fila = (n) => ({ id: `id-${n}`, nombre: `Fila ${n}`, _cursor: `2026-01-01 00:00:${String(n).padStart(2, '0')}+00` });
const base = { nombreArchivo: 'prueba', tabla: 't', columnas: 'id, nombre', columnaFecha: 'creado_en' };

beforeEach(() => vi.clearAllMocks());

describe('celdaCsv', () => {
  it('neutraliza fórmulas y escapa comas, comillas y saltos de línea', () => {
    expect(celdaCsv('=1+1')).toBe(`"'=1+1"`);
    expect(celdaCsv('-2')).toBe(`"'-2"`);
    expect(celdaCsv('a,b')).toBe('"a,b"');
    expect(celdaCsv('di "hola"')).toBe('"di ""hola"""');
    expect(celdaCsv(null)).toBe('');
    expect(lineaCsv(['x', undefined, 3])).toBe('x,,3');
  });
});

describe('transmitirCsv', () => {
  it('lee en bloques con llave (fecha, id) hasta agotar las filas', async () => {
    query
      .mockResolvedValueOnce({ rows: [{ total: 3 }] })
      .mockResolvedValueOnce({ rows: [fila(3), fila(2)] })
      .mockResolvedValueOnce({ rows: [fila(1)] });
    const res = mockRes();

    const out = await transmitirCsv({ res, ...base, tamanoBloque: 2 });

    expect(out).toEqual({ filas: 3 });
    expect(res.cuerpo.replace('﻿', '').split('\r\n').filter(Boolean)).toEqual([
      'id,nombre', 'id-3,Fila 3', 'id-2,Fila 2', 'id-1,Fila 1',
    ]);
    const [sql, params] = query.mock.calls[2];
    expect(sql).toMatch(/\(creado_en, id\) < \(\$1::timestamptz, \$2\)/);
    expect(params).toEqual(['2026-01-01 00:00:02+00', 'id-2', 2]);
    expect(res.end).toHaveBeenCalledOnce();
  });

  it('espera el drenaje cuando la conexión aplica contrapresión', async () => {
    query.mockResolvedValueOnce({ rows: [{ total: 1 }] }).mockResolvedValueOnce({ rows: [fila(1)] });
    const res = mockRes({ buffer: false });

    await transmitirCsv({ res, ...base });

    expect(res.once).toHaveBeenCalledWith('drain', expect.any(Function));
    expect(res.end).toHaveBeenCalledOnce();
  });

  it('responde 400 sin enviar nada si supera el tope', async () => {
    query.mockResolvedValueOnce({ rows: [{ total: 11 }] });
    const res = mockRes();
    const alIniciar = vi.fn();

    const out = await transmitirCsv({ res, ...base, maxFilas: 10, alIniciar });

    expect(out).toBeNull();
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.write).not.toHaveBeenCalled();
    expect(alIniciar).not.toHaveBeenCalled();
  });

  it('sin filas entrega un archivo con solo el BOM', async () => {
    query.mockResolvedValueOnce({ rows: [{ total: 0 }] }).mockResolvedValueOnce({ rows: [] });
    const res = mockRes();

    await transmitirCsv({ res, ...base });

    expect(res.cuerpo).toBe('﻿');
    expect(res.end).toHaveBeenCalledOnce();
  });

  it('omite las columnas excluidas y la llave interna', async () => {
    query.mockResolvedValueOnce({ rows: [{ total: 1 }] })
      .mockResolvedValueOnce({ rows: [{ ...fila(1), secreto: 'x' }] });
    const res = mockRes();

    await transmitirCsv({ res, ...base, excluir: new Set(['secreto']) });

    expect(res.cuerpo).not.toMatch(/secreto|_cursor/);
  });

  it('si la base falla antes de enviar, propaga el error y no inicia la descarga', async () => {
    query.mockResolvedValueOnce({ rows: [{ total: 1 }] }).mockRejectedValueOnce(new Error('caído'));
    const res = mockRes();

    await expect(transmitirCsv({ res, ...base })).rejects.toThrow('caído');
    expect(res.write).not.toHaveBeenCalled();
    expect(res.destroy).not.toHaveBeenCalled();
  });

  it('si falla a mitad, corta la conexión en vez de dejar un archivo truncado', async () => {
    query.mockResolvedValueOnce({ rows: [{ total: 4 }] })
      .mockResolvedValueOnce({ rows: [fila(4), fila(3)] })
      .mockRejectedValueOnce(new Error('caído'));
    const res = mockRes();

    const out = await transmitirCsv({ res, ...base, tamanoBloque: 2 });

    expect(out).toBeNull();
    expect(res.destroy).toHaveBeenCalledOnce();
    expect(res.end).not.toHaveBeenCalled();
  });

  it('deja de leer si el cliente cierra la conexión', async () => {
    query.mockResolvedValueOnce({ rows: [{ total: 4 }] }).mockResolvedValueOnce({ rows: [fila(4), fila(3)] });
    const res = mockRes();
    res.write.mockImplementation((s) => { res.cuerpo += s; res.destroyed = true; return true; });

    await transmitirCsv({ res, ...base, tamanoBloque: 2 });

    expect(query).toHaveBeenCalledTimes(2);
    expect(res.end).not.toHaveBeenCalled();
  });
});
