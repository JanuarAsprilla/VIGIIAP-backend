import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../src/config/database.js', () => ({ query: vi.fn() }));
vi.mock('../src/utils/logger.js', () => ({ default: { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() } }));

import { query } from '../src/config/database.js';
import { versionVigente, registrarConsentimiento } from '../src/modules/auth/consentimiento.js';

beforeEach(() => vi.mocked(query).mockReset());

describe('versionVigente()', () => {
  it('es una huella de 16 hex del texto vigente y cambia si cambia cualquiera de los textos', async () => {
    vi.mocked(query).mockResolvedValue({ rows: [{ clave: 'politicaPrivacidad', valor: 'Política A' }, { clave: 'terminosUso', valor: 'Términos A' }] });
    const a = await versionVigente();
    expect(a).toMatch(/^[0-9a-f]{16}$/);
    expect(await versionVigente()).toBe(a);
    vi.mocked(query).mockResolvedValue({ rows: [{ clave: 'politicaPrivacidad', valor: 'Política B' }, { clave: 'terminosUso', valor: 'Términos A' }] });
    expect(await versionVigente()).not.toBe(a);
  });

  it('con los textos de respaldo (sin configurar) devuelve «predeterminado»', async () => {
    vi.mocked(query).mockResolvedValue({ rows: [] });
    expect(await versionVigente()).toBe('predeterminado');
    vi.mocked(query).mockResolvedValue({ rows: [{ clave: 'politicaPrivacidad', valor: '   ' }] });
    expect(await versionVigente()).toBe('predeterminado');
  });
});

describe('registrarConsentimiento()', () => {
  it('guarda la fecha del servidor y la versión vigente en la fila de la persona', async () => {
    vi.mocked(query)
      .mockResolvedValueOnce({ rows: [{ clave: 'politicaPrivacidad', valor: 'Política A' }] })
      .mockResolvedValueOnce({ rows: [] });
    const version = await registrarConsentimiento('u1');
    const [sql, params] = vi.mocked(query).mock.calls[1];
    expect(sql).toMatch(/SET terminos_aceptados_en = NOW\(\), terminos_version = \$1 WHERE id = \$2/);
    expect(params).toEqual([version, 'u1']);
  });
});
