import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../src/config/database.js', () => ({
  query: vi.fn(),
}));

vi.mock('../src/utils/logger.js', () => ({
  default: { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() },
}));

vi.mock('../src/utils/auditLog.js', () => ({
  registrarAuditoria: vi.fn(),
}));

vi.mock('../src/config/dynamicConfig.js', () => ({
  clearDynamicConfigCache: vi.fn(),
}));

import { query } from '../src/config/database.js';
import { registrarAuditoria } from '../src/utils/auditLog.js';
import { clearDynamicConfigCache } from '../src/config/dynamicConfig.js';
import { recordRequest, recordBlocked, snapshotAndReset } from '../src/utils/trafficMonitor.js';
import {
  runRateLimitAutoScaleCheck,
  startRateLimitAutoScaler,
  stopRateLimitAutoScaler,
} from '../src/utils/rateLimitAutoScaler.js';

function mockCurrentLimit(valor) {
  query.mockResolvedValueOnce({ rows: valor === null ? [] : [{ valor: String(valor) }] });
}

function poblarVentana({ total, bloqueadas }) {
  snapshotAndReset(); // por si quedó algo de un test anterior
  for (let i = 0; i < total - bloqueadas; i++) recordRequest();
  for (let i = 0; i < bloqueadas; i++) { recordRequest(); recordBlocked(); }
}

describe('runRateLimitAutoScaleCheck()', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    snapshotAndReset();
  });

  it('no hace nada si la ventana no alcanza el tamaño mínimo de muestra', async () => {
    poblarVentana({ total: 100, bloqueadas: 50 }); // tasa altísima, pero muy poco volumen
    await runRateLimitAutoScaleCheck();
    expect(query).not.toHaveBeenCalled();
  });

  it('no hace nada si la tasa de bloqueo está por debajo del umbral', async () => {
    poblarVentana({ total: 1000, bloqueadas: 5 }); // 0.5%, debajo del 2%
    await runRateLimitAutoScaleCheck();
    expect(query).not.toHaveBeenCalled();
  });

  it('sube rate_limit_max un 20% cuando la tasa de bloqueo supera el umbral con volumen suficiente', async () => {
    poblarVentana({ total: 1000, bloqueadas: 30 }); // 3%, por encima del 2%
    mockCurrentLimit(300);
    query.mockResolvedValueOnce({ rows: [] }); // el INSERT ... ON CONFLICT

    await runRateLimitAutoScaleCheck();

    expect(query).toHaveBeenNthCalledWith(2,
      expect.stringContaining('INSERT INTO configuracion'),
      ['360'], // 300 * 1.2
    );
    expect(clearDynamicConfigCache).toHaveBeenCalled();
    expect(registrarAuditoria).toHaveBeenCalledWith(expect.objectContaining({
      accion: 'rate_limit_auto_scale',
      modulo: 'sistema',
    }));
  });

  it('no sube por encima del techo duro (5000)', async () => {
    poblarVentana({ total: 1000, bloqueadas: 30 });
    mockCurrentLimit(4800); // 4800 * 1.2 = 5760, debe recortarse a 5000

    await runRateLimitAutoScaleCheck();

    expect(query).toHaveBeenNthCalledWith(2,
      expect.stringContaining('INSERT INTO configuracion'),
      ['5000'],
    );
  });

  it('no hace ningún cambio si ya está en el techo duro', async () => {
    poblarVentana({ total: 1000, bloqueadas: 30 });
    mockCurrentLimit(5000);

    await runRateLimitAutoScaleCheck();

    // Solo el SELECT de getCurrentLimit -- nunca llega al INSERT
    expect(query).toHaveBeenCalledTimes(1);
    expect(registrarAuditoria).not.toHaveBeenCalled();
  });

  it('usa el piso estático (300) si no hay ningún valor guardado todavía', async () => {
    poblarVentana({ total: 1000, bloqueadas: 30 });
    mockCurrentLimit(null);

    await runRateLimitAutoScaleCheck();

    expect(query).toHaveBeenNthCalledWith(2,
      expect.stringContaining('INSERT INTO configuracion'),
      ['360'], // 300 * 1.2
    );
  });

  it('no rompe el flujo si la base de datos falla', async () => {
    poblarVentana({ total: 1000, bloqueadas: 30 });
    query.mockRejectedValueOnce(new Error('conexión perdida'));

    await expect(runRateLimitAutoScaleCheck()).resolves.not.toThrow();
    expect(registrarAuditoria).not.toHaveBeenCalled();
  });
});

describe('startRateLimitAutoScaler() / stopRateLimitAutoScaler()', () => {
  it('el poll se puede iniciar y detener sin lanzar errores', () => {
    const handle = startRateLimitAutoScaler(60_000);
    expect(handle).toBeTruthy();
    stopRateLimitAutoScaler();
  });

  it('detenerlo dos veces seguidas no lanza error', () => {
    startRateLimitAutoScaler(60_000);
    stopRateLimitAutoScaler();
    expect(() => stopRateLimitAutoScaler()).not.toThrow();
  });
});
