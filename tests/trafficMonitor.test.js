import { describe, it, expect, beforeEach } from 'vitest';
import { recordRequest, recordBlocked, snapshotAndReset } from '../src/utils/trafficMonitor.js';

describe('trafficMonitor', () => {
  beforeEach(() => {
    // Vacía cualquier residuo de otro test tomando y descartando el snapshot.
    snapshotAndReset();
  });

  it('cuenta las peticiones y los bloqueos por separado', () => {
    recordRequest();
    recordRequest();
    recordRequest();
    recordBlocked('ip-1');

    expect(snapshotAndReset()).toEqual({ totalRequests: 3, blockedRequests: 1, blockedClients: 1 });
  });

  it('snapshotAndReset reinicia los contadores -- el siguiente snapshot arranca en cero', () => {
    recordRequest();
    recordBlocked('ip-1');
    snapshotAndReset();

    expect(snapshotAndReset()).toEqual({ totalRequests: 0, blockedRequests: 0, blockedClients: 0 });
  });

  it('sin ninguna petición registrada, el snapshot es todo ceros', () => {
    expect(snapshotAndReset()).toEqual({ totalRequests: 0, blockedRequests: 0, blockedClients: 0 });
  });

  it('cuenta clientes distintos bloqueados: un mismo cliente bloqueado muchas veces cuenta una sola vez', () => {
    for (let i = 0; i < 50; i++) recordBlocked('ip-1');
    recordBlocked('ip-2');

    expect(snapshotAndReset()).toMatchObject({ blockedRequests: 51, blockedClients: 2 });
  });

  it('acota la memoria: no registra más de 1000 clientes distintos por ventana', () => {
    for (let i = 0; i < 1500; i++) recordBlocked(`ip-${i}`);

    expect(snapshotAndReset().blockedClients).toBe(1000);
  });
});
