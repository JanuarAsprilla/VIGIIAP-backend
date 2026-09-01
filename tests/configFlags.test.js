/**
 * Tests unitarios para utils/configFlags.js
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../src/config/database.js', () => ({ query: vi.fn() }));

import { query } from '../src/config/database.js';
import { notificacionHabilitada } from '../src/utils/configFlags.js';

describe('notificacionHabilitada()', () => {
  beforeEach(() => vi.clearAllMocks());

  it('emailNotifs ausente en BD → habilitado (preserva el comportamiento actual, siempre enviaba)', async () => {
    query.mockResolvedValueOnce({ rows: [] });
    await expect(notificacionHabilitada('emailNotifs')).resolves.toBe(true);
  });

  it('emailNotifs="false" → deshabilitado', async () => {
    query.mockResolvedValueOnce({ rows: [{ clave: 'emailNotifs', valor: 'false' }] });
    await expect(notificacionHabilitada('emailNotifs')).resolves.toBe(false);
  });

  it('solicitudNotifs ausente en BD → habilitado (preserva el comportamiento actual)', async () => {
    query.mockResolvedValueOnce({ rows: [] });
    await expect(notificacionHabilitada('solicitudNotifs')).resolves.toBe(true);
  });

  it('solicitudNotifs="false" → deshabilitado aunque emailNotifs esté en true', async () => {
    query.mockResolvedValueOnce({ rows: [
      { clave: 'emailNotifs', valor: 'true' },
      { clave: 'solicitudNotifs', valor: 'false' },
    ] });
    await expect(notificacionHabilitada('solicitudNotifs')).resolves.toBe(false);
  });

  it('loginNotifs ausente en BD → deshabilitado (funcionalidad nueva, opt-in)', async () => {
    query.mockResolvedValueOnce({ rows: [] });
    await expect(notificacionHabilitada('loginNotifs')).resolves.toBe(false);
  });

  it('loginNotifs="true" → habilitado', async () => {
    query.mockResolvedValueOnce({ rows: [{ clave: 'loginNotifs', valor: 'true' }] });
    await expect(notificacionHabilitada('loginNotifs')).resolves.toBe(true);
  });

  it('emailNotifs="false" apaga solicitudNotifs aunque este esté explícitamente en "true" (master switch)', async () => {
    query.mockResolvedValueOnce({ rows: [
      { clave: 'emailNotifs', valor: 'false' },
      { clave: 'solicitudNotifs', valor: 'true' },
    ] });
    await expect(notificacionHabilitada('solicitudNotifs')).resolves.toBe(false);
  });

  it('emailNotifs="false" apaga loginNotifs aunque este esté explícitamente en "true" (master switch)', async () => {
    query.mockResolvedValueOnce({ rows: [
      { clave: 'emailNotifs', valor: 'false' },
      { clave: 'loginNotifs', valor: 'true' },
    ] });
    await expect(notificacionHabilitada('loginNotifs')).resolves.toBe(false);
  });

  it('consulta solo las dos claves relevantes (emailNotifs + la clave pedida)', async () => {
    query.mockResolvedValueOnce({ rows: [] });
    await notificacionHabilitada('solicitudNotifs');
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining('configuracion'),
      [['emailNotifs', 'solicitudNotifs']],
    );
  });
});
