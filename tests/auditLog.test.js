import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../src/config/database.js', () => ({ query: vi.fn(), getClient: vi.fn() }));
vi.mock('../src/utils/logger.js', () => ({
  default: { warn: vi.fn(), info: vi.fn(), error: vi.fn() },
}));

import { query } from '../src/config/database.js';
import { registrarAuditoria } from '../src/utils/auditLog.js';

describe('registrarAuditoria()', () => {
  beforeEach(() => vi.clearAllMocks());

  it('inserta en audit_log sin errores (rama try)', async () => {
    query.mockResolvedValueOnce({ rows: [] });
    await expect(registrarAuditoria({ accion: 'login', modulo: 'auth' })).resolves.not.toThrow();
    expect(query).toHaveBeenCalledOnce();
  });

  it('no propaga errores si el INSERT falla — rama catch silenciosa', async () => {
    query.mockRejectedValueOnce(new Error('DB connection lost'));
    await expect(registrarAuditoria({ accion: 'test', modulo: 'test' })).resolves.not.toThrow();
  });

  it('usa null como default para campos opcionales no enviados', async () => {
    query.mockResolvedValueOnce({ rows: [] });
    await registrarAuditoria({ accion: 'logout', modulo: 'auth' });
    const params = query.mock.calls[0][1];
    expect(params[2]).toBeNull(); // entidadId
    expect(params[3]).toBeNull(); // descripcion
  });
});
