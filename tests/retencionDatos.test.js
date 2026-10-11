import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../src/config/database.js', () => ({ query: vi.fn() }));
vi.mock('../src/utils/logger.js', () => ({
  default: { warn: vi.fn(), info: vi.fn(), error: vi.fn() },
}));

import { query } from '../src/config/database.js';
import logger from '../src/utils/logger.js';
import { purgarAnalitica, startRetencionScheduler, stopRetencionScheduler } from '../src/utils/retencionDatos.js';

describe('purgarAnalitica()', () => {
  beforeEach(() => vi.resetAllMocks());

  it('borra la IP de las sesiones antiguas y luego las sesiones muy antiguas', async () => {
    query.mockResolvedValueOnce({ rowCount: 3 }).mockResolvedValueOnce({ rowCount: 1 });

    const r = await purgarAnalitica();

    expect(r).toEqual({ ipsBorradas: 3, sesionesBorradas: 1 });
    expect(query.mock.calls[0][0]).toMatch(/UPDATE analytics_sessions SET ip = NULL/);
    expect(query.mock.calls[0][1]).toEqual([90]);
    expect(query.mock.calls[1][0]).toMatch(/DELETE FROM analytics_sessions/);
    expect(query.mock.calls[1][1]).toEqual([730]);
  });

  it('no registra nada en el log cuando no había qué borrar', async () => {
    query.mockResolvedValue({ rowCount: 0 });
    await purgarAnalitica();
    expect(logger.info).not.toHaveBeenCalled();
  });
});

describe('startRetencionScheduler()', () => {
  beforeEach(() => { vi.resetAllMocks(); vi.useFakeTimers(); });
  afterEach(() => { stopRetencionScheduler(); vi.useRealTimers(); });

  it('purga al arrancar y en cada intervalo, y un error de BD no lo detiene', async () => {
    query.mockRejectedValue(new Error('BD caída'));
    startRetencionScheduler(1000);
    await vi.advanceTimersByTimeAsync(0);
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('BD caída'));

    await vi.advanceTimersByTimeAsync(2000);
    expect(query.mock.calls.length).toBeGreaterThanOrEqual(3);
  });

  it('stop detiene las purgas siguientes', async () => {
    query.mockResolvedValue({ rowCount: 0 });
    startRetencionScheduler(1000);
    await vi.advanceTimersByTimeAsync(0);
    stopRetencionScheduler();
    const llamadas = query.mock.calls.length;
    await vi.advanceTimersByTimeAsync(5000);
    expect(query.mock.calls.length).toBe(llamadas);
  });
});
