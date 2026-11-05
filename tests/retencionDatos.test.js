import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../src/config/database.js', () => ({ query: vi.fn() }));
// El candado entre instancias se prueba en bloqueoTareas.test.js; aquí siempre se obtiene.
vi.mock('../src/utils/bloqueoTareas.js', () => ({
  conBloqueo: async (_nombre, tarea) => ({ ejecutada: true, resultado: await tarea() }),
}));
vi.mock('../src/utils/logger.js', () => ({
  default: { warn: vi.fn(), info: vi.fn(), error: vi.fn() },
}));

import { query } from '../src/config/database.js';
import logger from '../src/utils/logger.js';
import { purgarAnalitica, purgarRegistros, startRetencionScheduler, stopRetencionScheduler } from '../src/utils/retencionDatos.js';

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

describe('purgarRegistros()', () => {
  const VARIABLES = ['SESIONES_RETENCION_DIAS', 'VISITANTES_RETENCION_DIAS', 'ERROR_LOG_RETENCION_DIAS', 'DESCARGAS_RETENCION_DIAS', 'ESCANEOS_RETENCION_DIAS'];
  beforeEach(() => { vi.resetAllMocks(); VARIABLES.forEach((v) => delete process.env[v]); });
  afterEach(() => VARIABLES.forEach((v) => delete process.env[v]));

  const sqlsEjecutados = () => query.mock.calls.map(([sql]) => sql);

  it('por omisión purga sesiones vencidas, visitantes y errores, y NO toca los registros de custodia', async () => {
    query.mockResolvedValue({ rowCount: 2 });

    const r = await purgarRegistros();

    expect(r).toEqual({ sesiones: 2, visitantes: 2, errores: 2 });
    const sqls = sqlsEjecutados().join('\n');
    expect(sqls).toMatch(/refresh_tokens/);
    expect(sqls).toMatch(/visitantes/);
    expect(sqls).toMatch(/error_log/);
    expect(sqls).not.toMatch(/descarga_log|geo_custodia|file_scan_log/);
    expect(query.mock.calls.map(([, p]) => p[0])).toEqual([30, 90, 180]);
  });

  it('los registros de custodia se purgan solo cuando se configura un plazo', async () => {
    process.env.DESCARGAS_RETENCION_DIAS = '730';
    process.env.ESCANEOS_RETENCION_DIAS = '365';
    query.mockResolvedValue({ rowCount: 0 });

    await purgarRegistros();

    const sqls = sqlsEjecutados().join('\n');
    expect(sqls).toMatch(/descarga_log/);
    expect(sqls).toMatch(/geo_custodia/);
    expect(sqls).toMatch(/file_scan_log/);
    expect(query.mock.calls.find(([sql]) => /descarga_log/.test(sql))[1]).toEqual([730]);
    expect(query.mock.calls.find(([sql]) => /file_scan_log/.test(sql))[1]).toEqual([365]);
  });

  it('un plazo en 0 desactiva esa purga, incluso la de las que van activas por omisión', async () => {
    process.env.VISITANTES_RETENCION_DIAS = '0';
    query.mockResolvedValue({ rowCount: 0 });
    await purgarRegistros();
    expect(sqlsEjecutados().join('\n')).not.toMatch(/visitantes/);
  });

  it('ignora un valor inválido y usa el plazo por omisión', async () => {
    process.env.ERROR_LOG_RETENCION_DIAS = 'abc';
    query.mockResolvedValue({ rowCount: 0 });
    await purgarRegistros();
    expect(query.mock.calls.find(([sql]) => /error_log/.test(sql))[1]).toEqual([180]);
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
