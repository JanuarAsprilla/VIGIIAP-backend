import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../src/config/database.js', () => ({ getClient: vi.fn() }));

import { getClient } from '../src/config/database.js';
import { conBloqueo } from '../src/utils/bloqueoTareas.js';

function clienteSimulado({ obtenido = true } = {}) {
  const cliente = {
    query: vi.fn(async (sql) => (/pg_try_advisory_xact_lock/.test(sql) ? { rows: [{ obtenido }] } : { rows: [] })),
    release: vi.fn(),
  };
  getClient.mockResolvedValue(cliente);
  return cliente;
}
const sentencias = (cliente) => cliente.query.mock.calls.map(([sql]) => sql.trim().split(/\s+/)[0]);

beforeEach(() => vi.resetAllMocks());

describe('conBloqueo()', () => {
  it('con el candado ejecuta la tarea, confirma la transacción y libera la conexión', async () => {
    const cliente = clienteSimulado();
    const tarea = vi.fn().mockResolvedValue('listo');

    const r = await conBloqueo('reporte_semanal', tarea);

    expect(r).toEqual({ ejecutada: true, resultado: 'listo' });
    expect(tarea).toHaveBeenCalledOnce();
    expect(sentencias(cliente)).toEqual(['BEGIN', 'SELECT', 'COMMIT']);
    expect(cliente.release).toHaveBeenCalledOnce();
  });

  it('sin el candado (otra instancia lo tiene) no ejecuta la tarea y deshace la transacción', async () => {
    const cliente = clienteSimulado({ obtenido: false });
    const tarea = vi.fn();

    const r = await conBloqueo('reporte_semanal', tarea);

    expect(r).toEqual({ ejecutada: false });
    expect(tarea).not.toHaveBeenCalled();
    expect(sentencias(cliente)).toEqual(['BEGIN', 'SELECT', 'ROLLBACK']);
    expect(cliente.release).toHaveBeenCalledOnce();
  });

  it('si la tarea falla deshace la transacción, libera la conexión y propaga el error', async () => {
    const cliente = clienteSimulado();

    await expect(conBloqueo('retencion_auditoria', async () => { throw new Error('se cayó'); })).rejects.toThrow('se cayó');

    expect(sentencias(cliente)).toEqual(['BEGIN', 'SELECT', 'ROLLBACK']);
    expect(cliente.release).toHaveBeenCalledOnce();
  });

  it('el candado es por nombre y estable: el mismo nombre siempre pide la misma clave', async () => {
    const cliente = clienteSimulado();

    await conBloqueo('retencion_analitica', async () => {});
    await conBloqueo('retencion_analitica', async () => {});
    await conBloqueo('autoajuste_limite', async () => {});

    const claves = cliente.query.mock.calls.filter(([sql]) => /advisory/.test(sql)).map(([, params]) => params[0]);
    expect(claves[0]).toBe(claves[1]);
    expect(claves[0]).not.toBe(claves[2]);
  });

  it('usa el candado de transacción: se libera solo al terminar, aunque el proceso muera', async () => {
    const cliente = clienteSimulado();

    await conBloqueo('x', async () => {});

    const sql = cliente.query.mock.calls.find(([s]) => /advisory/.test(s))[0];
    expect(sql).toMatch(/pg_try_advisory_xact_lock/);
    expect(sql).not.toMatch(/pg_advisory_lock\(/);
  });
});
