import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../src/config/database.js', () => ({ query: vi.fn() }));

import { query } from '../src/config/database.js';
import { verificarIntegridadAuditoria } from '../src/modules/admin/integridadAuditoria.js';

describe('verificarIntegridadAuditoria()', () => {
  beforeEach(() => vi.resetAllMocks());

  it('una cadena sin problemas es íntegra y trae el rango verificado', async () => {
    query
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ verificados: 120, desde: '2026-01-01', hasta: '2026-10-11' }] });

    expect(await verificarIntegridadAuditoria()).toEqual({
      integra: true, verificados: 120, desde: '2026-01-01', hasta: '2026-10-11', problemas: [],
    });
  });

  it('con eventos problemáticos deja de ser íntegra y los lista', async () => {
    const problema = { id: 'e1', secuencia: '7', problema: 'contenido_alterado' };
    query
      .mockResolvedValueOnce({ rows: [problema] })
      .mockResolvedValueOnce({ rows: [{ verificados: 10, desde: null, hasta: null }] });

    const r = await verificarIntegridadAuditoria();

    expect(r.integra).toBe(false);
    expect(r.problemas).toEqual([problema]);
    expect(query.mock.calls[0][1]).toEqual([20]);
  });
});
