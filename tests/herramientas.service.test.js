/**
 * Tests unitarios para herramientas.service.js
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../src/config/database.js', () => ({ query: vi.fn(), getClient: vi.fn() }));

import { query, getClient } from '../src/config/database.js';
import { listar, crear, actualizar, reordenar, eliminar } from '../src/modules/herramientas/herramientas.service.js';

const HERRAMIENTA = {
  clave: 'conversor', titulo: 'Conversor de Coordenadas', descripcion: null,
  tag: 'Geodésico', activa: true, visibilidad: 'publico', orden: 0, creado_en: new Date(), actualizado_en: new Date(),
};

describe('herramientas.service → listar()', () => {
  beforeEach(() => vi.resetAllMocks());

  it('retorna la lista ordenada por orden y clave', async () => {
    query.mockResolvedValueOnce({ rows: [HERRAMIENTA] });
    const result = await listar();
    expect(result).toEqual([HERRAMIENTA]);
    const [sql] = query.mock.calls[0];
    expect(sql).toMatch(/ORDER BY orden ASC, clave ASC/);
  });

  it('sin isAdminView, filtra solo las activas', async () => {
    query.mockResolvedValueOnce({ rows: [] });
    await listar(false);
    const [sql] = query.mock.calls[0];
    expect(sql).toMatch(/AND activa = true/);
  });

  it('con isAdminView, no filtra por activa (ve también las inactivas)', async () => {
    query.mockResolvedValueOnce({ rows: [] });
    await listar(true);
    const [sql] = query.mock.calls[0];
    expect(sql).not.toMatch(/activa = true/);
  });

  it('con isAdminView, no filtra por visibilidad (ignora el rol de user)', async () => {
    query.mockResolvedValueOnce({ rows: [] });
    await listar(true, { rol: 'visitante' });
    const [sql, params] = query.mock.calls[0];
    expect(sql).not.toMatch(/visibilidad = ANY/);
    expect(params).toBeUndefined();
  });

  it('siempre excluye las borradas (deleted_at)', async () => {
    query.mockResolvedValueOnce({ rows: [] });
    await listar(true);
    const [sql] = query.mock.calls[0];
    expect(sql).toMatch(/deleted_at IS NULL/);
  });

  it('sin usuario (anónimo), restringe a visibilidad publico', async () => {
    query.mockResolvedValueOnce({ rows: [] });
    await listar(false, null);
    const [sql, params] = query.mock.calls[0];
    expect(sql).toMatch(/AND visibilidad = ANY\(\$1\)/);
    expect(params).toEqual([['publico']]);
  });

  it('rol visitante, restringe a visibilidad publico', async () => {
    query.mockResolvedValueOnce({ rows: [] });
    await listar(false, { rol: 'visitante' });
    const [, params] = query.mock.calls[0];
    expect(params).toEqual([['publico']]);
  });

  it('rol publico, restringe a visibilidad publico', async () => {
    query.mockResolvedValueOnce({ rows: [] });
    await listar(false, { rol: 'publico' });
    const [, params] = query.mock.calls[0];
    expect(params).toEqual([['publico']]);
  });

  it('rol investigador (usuario autenticado no-visitante), sin filtro de visibilidad', async () => {
    query.mockResolvedValueOnce({ rows: [] });
    await listar(false, { rol: 'investigador' });
    const [sql, params] = query.mock.calls[0];
    expect(sql).not.toMatch(/visibilidad = ANY/);
    expect(params).toEqual([]);
  });

  // Regresión: revisión de seguridad encontró que una versión anterior
  // colapsaba a "cualquier rol no visitante/publico ve todo" -- fallaba
  // ABIERTO ante un rol inesperado (typo, rol futuro que esta función
  // todavía no contempla). Debe fallar CERRADO: un rol no reconocido cae en
  // el filtro restringido (mismo criterio que mapas.service.js), nunca en
  // acceso total sin verificación explícita.
  it('rol no reconocido (ni staff conocido ni visitante/publico), falla cerrado -- no ve todo sin filtro', async () => {
    query.mockResolvedValueOnce({ rows: [] });
    await listar(false, { rol: 'rol-futuro-no-contemplado' });
    const [sql, params] = query.mock.calls[0];
    expect(sql).toMatch(/AND visibilidad = ANY\(\$1\)/);
    expect(params).toEqual([['publico', 'usuarios']]);
  });
});

describe('herramientas.service → crear()', () => {
  beforeEach(() => vi.resetAllMocks());

  it('crea con el orden explícito si se provee', async () => {
    query.mockResolvedValueOnce({ rows: [HERRAMIENTA] });
    await crear({ clave: 'conversor', titulo: 'Conversor', tag: 'Geodésico', orden: 3 });
    const [sql, params] = query.mock.calls[0];
    expect(sql).toMatch(/INSERT INTO herramientas/);
    expect(params).toEqual(['conversor', 'Conversor', null, 'Geodésico', 'publico', 3]);
  });

  it('sin orden explícito, calcula el siguiente (MAX(orden)+1)', async () => {
    query.mockResolvedValueOnce({ rows: [{ siguiente: 2 }] }); // siguienteOrden()
    query.mockResolvedValueOnce({ rows: [HERRAMIENTA] });      // INSERT
    await crear({ clave: 'nueva', titulo: 'Nueva', tag: 'Reportes' });
    expect(query).toHaveBeenCalledTimes(2);
    const [, params] = query.mock.calls[1];
    expect(params[5]).toBe(2);
  });

  it('sin visibilidad explícita, por defecto es publico', async () => {
    query.mockResolvedValueOnce({ rows: [HERRAMIENTA] });
    await crear({ clave: 'conversor', titulo: 'Conversor', tag: 'Geodésico', orden: 0 });
    const [, params] = query.mock.calls[0];
    expect(params[4]).toBe('publico');
  });

  it('acepta visibilidad explícita "usuarios"', async () => {
    query.mockResolvedValueOnce({ rows: [{ ...HERRAMIENTA, visibilidad: 'usuarios' }] });
    await crear({ clave: 'conversor', titulo: 'Conversor', tag: 'Geodésico', visibilidad: 'usuarios', orden: 0 });
    const [, params] = query.mock.calls[0];
    expect(params[4]).toBe('usuarios');
  });

  it('descripcion ausente se guarda como null', async () => {
    query.mockResolvedValueOnce({ rows: [HERRAMIENTA] });
    await crear({ clave: 'conversor', titulo: 'Conversor', tag: 'Geodésico', orden: 0 });
    const [, params] = query.mock.calls[0];
    expect(params[2]).toBeNull();
  });
});

describe('herramientas.service → actualizar()', () => {
  beforeEach(() => vi.resetAllMocks());

  it('actualiza solo los campos provistos', async () => {
    query.mockResolvedValueOnce({ rows: [{ ...HERRAMIENTA, activa: false }] });
    await actualizar('conversor', { activa: false });
    const [sql, params] = query.mock.calls[0];
    expect(sql).toMatch(/SET activa = \$2, actualizado_en = NOW\(\)/);
    expect(params).toEqual(['conversor', false]);
  });

  it('ignora campos no editables (ej. clave) si vinieran en el objeto', async () => {
    query.mockResolvedValueOnce({ rows: [HERRAMIENTA] });
    await actualizar('conversor', { titulo: 'Nuevo título', clave: 'otra-clave' });
    const [sql, params] = query.mock.calls[0];
    // El SET solo debe tocar `titulo` — `clave` sigue apareciendo en el WHERE
    // (identidad de la fila), por eso se compara solo la porción SET.
    expect(sql.split('WHERE')[0]).not.toMatch(/\bclave\b/);
    expect(params).toEqual(['conversor', 'Nuevo título']);
  });

  it('lanza 400 si no hay campos editables en el objeto', async () => {
    await expect(actualizar('conversor', { clave: 'otra' })).rejects.toMatchObject({ status: 400 });
    expect(query).not.toHaveBeenCalled();
  });

  it('lanza 404 si la herramienta no existe', async () => {
    query.mockResolvedValueOnce({ rows: [] });
    await expect(actualizar('no-existe', { activa: false })).rejects.toMatchObject({ status: 404 });
  });
});

describe('herramientas.service → reordenar()', () => {
  beforeEach(() => vi.resetAllMocks());

  function mockClient(queryImpl) {
    const client = { query: vi.fn(queryImpl), release: vi.fn() };
    getClient.mockResolvedValueOnce(client);
    return client;
  }

  it('actualiza el orden de cada herramienta en una transacción', async () => {
    const client = mockClient((sql) => {
      if (sql === 'BEGIN' || sql === 'COMMIT') return Promise.resolve({});
      return Promise.resolve({ rowCount: 1 });
    });

    await reordenar([{ clave: 'conversor', orden: 1 }, { clave: 'panel-choco', orden: 0 }]);

    expect(client.query).toHaveBeenCalledWith('BEGIN');
    expect(client.query).toHaveBeenCalledWith(expect.stringMatching(/UPDATE herramientas SET orden/), ['conversor', 1]);
    expect(client.query).toHaveBeenCalledWith(expect.stringMatching(/UPDATE herramientas SET orden/), ['panel-choco', 0]);
    expect(client.query).toHaveBeenCalledWith('COMMIT');
    expect(client.release).toHaveBeenCalledOnce();
  });

  it('hace rollback y lanza 404 si alguna clave no existe', async () => {
    const client = mockClient((sql, params) => {
      if (sql === 'BEGIN') return Promise.resolve({});
      if (params?.[0] === 'no-existe') return Promise.resolve({ rowCount: 0 });
      return Promise.resolve({ rowCount: 1 });
    });

    await expect(reordenar([{ clave: 'no-existe', orden: 0 }])).rejects.toMatchObject({ status: 404 });
    expect(client.query).toHaveBeenCalledWith('ROLLBACK');
    expect(client.release).toHaveBeenCalledOnce();
  });
});

describe('herramientas.service → eliminar()', () => {
  beforeEach(() => vi.resetAllMocks());

  it('marca deleted_at de la herramienta existente', async () => {
    query.mockResolvedValueOnce({ rowCount: 1 });
    await eliminar('conversor');
    const [sql, params] = query.mock.calls[0];
    expect(sql).toMatch(/SET deleted_at = NOW\(\)/);
    expect(params).toEqual(['conversor']);
  });

  it('lanza 404 si la herramienta no existe', async () => {
    query.mockResolvedValueOnce({ rowCount: 0 });
    await expect(eliminar('no-existe')).rejects.toMatchObject({ status: 404 });
  });
});
