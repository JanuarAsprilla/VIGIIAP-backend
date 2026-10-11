import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../src/config/database.js', () => ({ query: vi.fn(), getClient: vi.fn() }));
vi.mock('../src/utils/logger.js', () => ({
  default: { warn: vi.fn(), info: vi.fn(), error: vi.fn() },
}));

import { query } from '../src/config/database.js';
import { registrarAuditoria } from '../src/utils/auditLog.js';
import { ejecutarConContexto } from '../src/utils/contextoPeticion.js';

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

  it('completa IP, navegador, request id y usuario desde el contexto de la petición', async () => {
    query.mockResolvedValueOnce({ rows: [] });
    await ejecutarConContexto(
      { requestId: 'req-1', ip: '9.9.9.9', userAgent: 'UA', usuarioId: 'u1', usuarioEmail: 'u@x.co' },
      () => registrarAuditoria({ accion: 'a', modulo: 'm' })
    );
    const p = query.mock.calls[0][1];
    expect(p[4]).toBe('u1');
    expect(p[5]).toBe('u@x.co');
    expect(p[6]).toBe('9.9.9.9');
    expect(p[7]).toBe('UA');
    expect(p[8]).toBe('exito');
    expect(p[9]).toBe('req-1');
  });

  it('lo explícito manda sobre el contexto y serializa los cambios', async () => {
    query.mockResolvedValueOnce({ rows: [] });
    await ejecutarConContexto({ ip: '9.9.9.9' }, () => registrarAuditoria({
      accion: 'a', modulo: 'm', ip: '1.1.1.1', resultado: 'fallo', entidadTipo: 'usuario',
      cambios: { rol: { antes: 'a', despues: 'b' } },
    }));
    const p = query.mock.calls[0][1];
    expect(p[6]).toBe('1.1.1.1');
    expect(p[8]).toBe('fallo');
    expect(p[10]).toBe(JSON.stringify({ rol: { antes: 'a', despues: 'b' } }));
    expect(p[11]).toBe('usuario');
  });
});
