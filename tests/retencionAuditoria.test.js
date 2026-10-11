import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../src/config/database.js', () => ({ getClient: vi.fn() }));
vi.mock('../src/utils/logger.js', () => ({ default: { warn: vi.fn(), info: vi.fn(), error: vi.fn() } }));

import { getClient } from '../src/config/database.js';
import logger from '../src/utils/logger.js';
import { purgarAuditoria, startRetencionAuditoria, stopRetencionAuditoria } from '../src/utils/retencionAuditoria.js';

function clienteSimulado(rowCount = 0, falla = null) {
  const cliente = {
    query: vi.fn(async (sql) => {
      if (falla && /DELETE FROM audit_log/.test(sql)) throw falla;
      return /DELETE FROM audit_log/.test(sql) ? { rowCount } : {};
    }),
    release: vi.fn(),
  };
  getClient.mockResolvedValue(cliente);
  return cliente;
}

describe('purgarAuditoria()', () => {
  beforeEach(() => vi.resetAllMocks());

  it('borra un prefijo de la cadena dentro de una transacción con la purga habilitada', async () => {
    const cliente = clienteSimulado(4);

    const r = await purgarAuditoria();

    expect(r).toEqual({ eventosBorrados: 4 });
    const sentencias = cliente.query.mock.calls.map(([sql]) => sql);
    expect(sentencias[0]).toBe('BEGIN');
    expect(sentencias[1]).toMatch(/SET LOCAL app\.purga_auditoria = 'on'/);
    expect(sentencias[2]).toMatch(/DELETE FROM audit_log\s+WHERE secuencia <= \(/);
    expect(cliente.query.mock.calls[2][1]).toEqual([730]);
    expect(sentencias[3]).toBe('COMMIT');
    expect(cliente.release).toHaveBeenCalled();
  });

  it('si el borrado falla deshace la transacción, libera el cliente y propaga el error', async () => {
    const cliente = clienteSimulado(0, new Error('boom'));

    await expect(purgarAuditoria()).rejects.toThrow('boom');

    expect(cliente.query.mock.calls.map(([sql]) => sql)).toContain('ROLLBACK');
    expect(cliente.release).toHaveBeenCalled();
  });
});

describe('startRetencionAuditoria()', () => {
  beforeEach(() => { vi.resetAllMocks(); vi.useFakeTimers(); });
  afterEach(() => { stopRetencionAuditoria(); vi.useRealTimers(); });

  it('un error en la purga se registra y no detiene el programador', async () => {
    clienteSimulado(0, new Error('BD caída'));
    startRetencionAuditoria(1000);
    await vi.advanceTimersByTimeAsync(2500);

    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('BD caída'));
    expect(getClient.mock.calls.length).toBeGreaterThanOrEqual(3);
  });
});
