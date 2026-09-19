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
    recordBlocked();

    expect(snapshotAndReset()).toEqual({ totalRequests: 3, blockedRequests: 1 });
  });

  it('snapshotAndReset reinicia los contadores -- el siguiente snapshot arranca en cero', () => {
    recordRequest();
    recordBlocked();
    snapshotAndReset();

    expect(snapshotAndReset()).toEqual({ totalRequests: 0, blockedRequests: 0 });
  });

  it('sin ninguna petición registrada, el snapshot es todo ceros', () => {
    expect(snapshotAndReset()).toEqual({ totalRequests: 0, blockedRequests: 0 });
  });
});
