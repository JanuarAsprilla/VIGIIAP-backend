import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../src/utils/logger.js', () => ({
  default: { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() },
}));

import { crearAlmacen } from '../src/middlewares/almacenLimitador.js';

const VENTANA_MS = 900_000;

function clienteSimulado({ listo = true, conteo = 1, ttl = VENTANA_MS } = {}) {
  return {
    isReady: listo,
    eval: vi.fn(async () => [conteo, ttl]),
    del: vi.fn(async () => 1),
    decr: vi.fn(async () => 0),
  };
}

function almacen(cliente, opciones = {}) {
  const a = crearAlmacen('general', { obtenerCliente: () => cliente, ...opciones });
  a.init({ windowMs: VENTANA_MS });
  return a;
}

beforeEach(() => vi.clearAllMocks());
afterEach(() => vi.useRealTimers());

describe('almacén compartido del limitador — con Redis', () => {
  it('cuenta en Redis con un solo comando atómico y una clave propia del limitador', async () => {
    const cliente = clienteSimulado({ conteo: 7, ttl: 120_000 });
    const a = almacen(cliente);

    const r = await a.increment('203.0.113.9');

    expect(cliente.eval).toHaveBeenCalledOnce();
    const [script, opciones] = cliente.eval.mock.calls[0];
    expect(script).toMatch(/INCR/);
    expect(script).toMatch(/PEXPIRE/);
    expect(opciones).toEqual({ keys: ['rl:general:203.0.113.9'], arguments: [String(VENTANA_MS)] });
    expect(r.totalHits).toBe(7);
    expect(r.resetTime.getTime()).toBeGreaterThan(Date.now() + 100_000);
  });

  it('limitadores distintos usan prefijos distintos y no comparten contador', async () => {
    const cliente = clienteSimulado();
    const general = crearAlmacen('general', { obtenerCliente: () => cliente });
    const login = crearAlmacen('login', { obtenerCliente: () => cliente });
    general.init({ windowMs: VENTANA_MS });
    login.init({ windowMs: VENTANA_MS });

    await general.increment('1.1.1.1');
    await login.increment('1.1.1.1');

    expect(cliente.eval.mock.calls[0][1].keys[0]).toBe('rl:general:1.1.1.1');
    expect(cliente.eval.mock.calls[1][1].keys[0]).toBe('rl:login:1.1.1.1');
  });

  it('si la clave quedó sin vencimiento usa la ventana completa como reinicio', async () => {
    const a = almacen(clienteSimulado({ conteo: 1, ttl: -1 }));

    const r = await a.increment('x');

    expect(r.resetTime.getTime()).toBeGreaterThan(Date.now() + VENTANA_MS - 5_000);
  });

  it('resetKey borra la clave en Redis', async () => {
    const cliente = clienteSimulado();
    const a = almacen(cliente);

    await a.resetKey('1.2.3.4');

    expect(cliente.del).toHaveBeenCalledWith('rl:general:1.2.3.4');
  });

  it('decrement resta en Redis', async () => {
    const cliente = clienteSimulado();
    const a = almacen(cliente);

    await a.decrement('1.2.3.4');

    expect(cliente.decr).toHaveBeenCalledWith('rl:general:1.2.3.4');
  });
});

describe('almacén compartido del limitador — sin Redis o con Redis caído', () => {
  it('sin Redis configurado cuenta en memoria de la instancia y sigue limitando', async () => {
    const a = crearAlmacen('general', { obtenerCliente: () => null });
    a.init({ windowMs: VENTANA_MS });

    const cuentas = [];
    for (let i = 0; i < 3; i += 1) cuentas.push((await a.increment('ip')).totalHits);

    expect(cuentas).toEqual([1, 2, 3]);
  });

  it('con el cliente aún sin conectar usa memoria', async () => {
    const cliente = clienteSimulado({ listo: false });
    const a = almacen(cliente);

    const r = await a.increment('ip');

    expect(r.totalHits).toBe(1);
    expect(cliente.eval).not.toHaveBeenCalled();
  });

  it('si Redis falla en una petición, esa petición se cuenta en memoria y no lanza', async () => {
    const cliente = clienteSimulado();
    cliente.eval.mockRejectedValueOnce(new Error('ECONNRESET'));
    const a = almacen(cliente);

    const r = await a.increment('ip');

    expect(r.totalHits).toBe(1);
  });

  it('tras un fallo no insiste con Redis durante el enfriamiento, y después vuelve a usarlo', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-04T10:00:00Z'));
    const cliente = clienteSimulado();
    cliente.eval.mockRejectedValueOnce(new Error('caído'));
    const a = almacen(cliente, { enfriamientoMs: 5_000 });

    await a.increment('ip');
    await a.increment('ip');
    expect(cliente.eval).toHaveBeenCalledTimes(1);

    vi.setSystemTime(new Date('2026-11-04T10:00:06Z'));
    await a.increment('ip');
    expect(cliente.eval).toHaveBeenCalledTimes(2);
  });

  it('si Redis no responde a tiempo no deja colgada la petición: cae a memoria', async () => {
    vi.useFakeTimers();
    const cliente = clienteSimulado();
    cliente.eval.mockImplementation(() => new Promise(() => {}));
    const a = almacen(cliente, { timeoutMs: 250 });

    const pendiente = a.increment('ip');
    await vi.advanceTimersByTimeAsync(300);
    const r = await pendiente;

    expect(r.totalHits).toBe(1);
  });

  it('resetKey y decrement no lanzan si Redis falla', async () => {
    const cliente = clienteSimulado();
    cliente.del.mockRejectedValue(new Error('caído'));
    cliente.decr.mockRejectedValue(new Error('caído'));
    const a = almacen(cliente);

    await expect(a.resetKey('ip')).resolves.toBeUndefined();
    await expect(a.decrement('ip')).resolves.toBeUndefined();
  });
});
