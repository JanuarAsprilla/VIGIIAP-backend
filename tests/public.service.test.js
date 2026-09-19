/**
 * Tests unitarios para public.service.js
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../src/config/database.js', () => ({ query: vi.fn(), getClient: vi.fn() }));

import { query } from '../src/config/database.js';
import { getConfiguracionPublica } from '../src/modules/public/public.service.js';

describe('public.service → getConfiguracionPublica()', () => {
  beforeEach(() => vi.resetAllMocks());

  it('restringe la consulta SQL a las 4 claves whitelisteadas (no reutiliza el SELECT completo del admin)', async () => {
    query.mockResolvedValueOnce({ rows: [] });
    await getConfiguracionPublica();

    expect(query).toHaveBeenCalledOnce();
    const [sql, params] = query.mock.calls[0];
    expect(sql).toMatch(/WHERE clave = ANY/);
    expect(params[0].sort()).toEqual(['politicaPrivacidad', 'terminosUso', 'siteDesc', 'siteName'].sort());
  });

  it('devuelve las 4 claves con sus valores cuando existen en BD', async () => {
    query.mockResolvedValueOnce({
      rows: [
        { clave: 'politicaPrivacidad', valor: 'Texto legal.' },
        { clave: 'terminosUso', valor: 'Términos de uso.' },
        { clave: 'siteName', valor: 'VIGIIAP' },
        { clave: 'siteDesc', valor: 'Descripción del sitio' },
      ],
    });

    const result = await getConfiguracionPublica();

    expect(result).toEqual({
      politicaPrivacidad: 'Texto legal.',
      terminosUso: 'Términos de uso.',
      siteName: 'VIGIIAP',
      siteDesc: 'Descripción del sitio',
    });
  });

  it('devuelve null (no omite la clave) cuando alguna no existe todavía en BD', async () => {
    query.mockResolvedValueOnce({ rows: [{ clave: 'siteName', valor: 'VIGIIAP' }] });

    const result = await getConfiguracionPublica();

    expect(result).toEqual({
      politicaPrivacidad: null,
      terminosUso: null,
      siteName: 'VIGIIAP',
      siteDesc: null,
    });
  });
});
