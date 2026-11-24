import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../src/config/database.js', () => ({ query: vi.fn(), getClient: vi.fn() }));
vi.mock('../src/utils/bloqueoTareas.js', () => ({ conBloqueo: vi.fn() }));
vi.mock('../src/modules/geovisores/inventarioGeoserver.service.js', () => ({ sincronizarConexion: vi.fn() }));

import { query } from '../src/config/database.js';
import { conBloqueo } from '../src/utils/bloqueoTareas.js';
import { sincronizarConexion } from '../src/modules/geovisores/inventarioGeoserver.service.js';
import {
  iniciarSincronizacionInventario, detenerSincronizacionInventario, ejecutarCicloSincronizacion,
  INTERVALO_SINCRONIZACION_POR_DEFECTO_MS, RETRASO_PRIMER_CICLO_MS,
} from '../src/modules/geovisores/inventarioGeoserver.planificador.js';

beforeEach(() => {
  vi.useFakeTimers();
  vi.resetAllMocks();
  delete process.env.GEOSERVER_SYNC;
  delete process.env.GEOSERVER_SYNC_INTERVALO_MS;
  vi.mocked(conBloqueo).mockImplementation(async (_n, tarea) => ({ ejecutada: true, resultado: await tarea() }));
  vi.mocked(query).mockResolvedValue({ rows: [{ id: 'c1' }, { id: 'c2' }] });
  vi.mocked(sincronizarConexion).mockResolvedValue({ estado: 'ok' });
});

afterEach(() => {
  detenerSincronizacionInventario();
  vi.useRealTimers();
});

describe('ciclo de sincronización', () => {
  it('recorre las conexiones activas bajo un candado para que solo una instancia sincronice', async () => {
    await ejecutarCicloSincronizacion();

    expect(conBloqueo).toHaveBeenCalledWith('geoserver_inventario_ciclo', expect.any(Function));
    expect(query.mock.calls[0][0]).toMatch(/activo = true/);
    expect(sincronizarConexion.mock.calls).toEqual([['c1', { origen: 'planificador' }], ['c2', { origen: 'planificador' }]]);
  });

  it('si otra instancia tiene el candado no sincroniza nada', async () => {
    vi.mocked(conBloqueo).mockResolvedValue({ ejecutada: false });
    await ejecutarCicloSincronizacion();
    expect(sincronizarConexion).not.toHaveBeenCalled();
  });

  it('una conexión ocupada (a demanda) o que falla no impide sincronizar las demás ni lanza', async () => {
    vi.mocked(sincronizarConexion)
      .mockRejectedValueOnce(Object.assign(new Error('en curso'), { code: 'SINCRONIZACION_EN_CURSO' }))
      .mockResolvedValueOnce({ estado: 'ok' });

    await expect(ejecutarCicloSincronizacion()).resolves.toBeUndefined();

    expect(sincronizarConexion).toHaveBeenCalledTimes(2);
  });

  it('un fallo al listar las conexiones no lanza', async () => {
    vi.mocked(query).mockRejectedValue(new Error('BD caída'));
    await expect(ejecutarCicloSincronizacion()).resolves.toBeUndefined();
  });

  it('dos ciclos simultáneos en la misma instancia no se solapan', async () => {
    const liberadores = [];
    vi.mocked(sincronizarConexion).mockImplementation(() => new Promise((resolver) => { liberadores.push(resolver); }));

    const primero = ejecutarCicloSincronizacion();
    await vi.advanceTimersByTimeAsync(0);
    await ejecutarCicloSincronizacion();
    expect(conBloqueo).toHaveBeenCalledTimes(1);

    liberadores.shift()({ estado: 'ok' });
    await vi.advanceTimersByTimeAsync(0);
    liberadores.shift()({ estado: 'ok' });
    await primero;
  });
});

describe('iniciarSincronizacionInventario()', () => {
  it('el primer ciclo llega tras un retraso corto y luego cada 10 minutos por omisión', async () => {
    iniciarSincronizacionInventario();

    await vi.advanceTimersByTimeAsync(RETRASO_PRIMER_CICLO_MS - 1);
    expect(conBloqueo).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(conBloqueo).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(INTERVALO_SINCRONIZACION_POR_DEFECTO_MS);
    expect(conBloqueo).toHaveBeenCalledTimes(2);
  });

  it('GEOSERVER_SYNC_INTERVALO_MS cambia el intervalo', async () => {
    process.env.GEOSERVER_SYNC_INTERVALO_MS = '60000';
    iniciarSincronizacionInventario({ retrasoInicialMs: 1000 });

    await vi.advanceTimersByTimeAsync(1000);
    await vi.advanceTimersByTimeAsync(60_000);

    expect(conBloqueo).toHaveBeenCalledTimes(2);
  });

  it('GEOSERVER_SYNC=false lo apaga: no programa nada', async () => {
    process.env.GEOSERVER_SYNC = 'false';
    expect(iniciarSincronizacionInventario()).toBeNull();

    await vi.advanceTimersByTimeAsync(INTERVALO_SINCRONIZACION_POR_DEFECTO_MS * 2);
    expect(conBloqueo).not.toHaveBeenCalled();
  });

  it('detener cancela el primer ciclo y el intervalo', async () => {
    iniciarSincronizacionInventario();

    detenerSincronizacionInventario();
    await vi.advanceTimersByTimeAsync(INTERVALO_SINCRONIZACION_POR_DEFECTO_MS * 2);

    expect(conBloqueo).not.toHaveBeenCalled();
  });

  it('el intervalo no sostiene el proceso abierto (unref)', () => {
    const intervalo = iniciarSincronizacionInventario();
    expect(intervalo.hasRef()).toBe(false);
  });

  it('reiniciar no deja temporizadores duplicados', async () => {
    iniciarSincronizacionInventario({ intervaloMs: 1000, retrasoInicialMs: 10 });
    iniciarSincronizacionInventario({ intervaloMs: 1000, retrasoInicialMs: 10 });

    await vi.advanceTimersByTimeAsync(10);
    expect(conBloqueo).toHaveBeenCalledTimes(1);
  });
});
