/**
 * Tests para utils/passwordPolicy.js — validarLongitudMinima() es el
 * chequeo adicional contra la longitud mínima configurable por el
 * super_admin, por encima del piso fijo de 8 que ya exige strongPassword.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../src/config/dynamicConfig.js', () => ({
  getPasswordMinLength: vi.fn(),
}));

import { getPasswordMinLength } from '../src/config/dynamicConfig.js';
import { validarLongitudMinima, strongPassword } from '../src/utils/passwordPolicy.js';

beforeEach(() => { vi.clearAllMocks(); });

describe('validarLongitudMinima()', () => {
  it('no lanza si la contraseña cumple el mínimo configurado', async () => {
    vi.mocked(getPasswordMinLength).mockResolvedValue(10);
    await expect(validarLongitudMinima('Passw0rd!!')).resolves.toBeUndefined();
  });

  it('lanza 422 si la contraseña es más corta que el mínimo configurado', async () => {
    vi.mocked(getPasswordMinLength).mockResolvedValue(12);
    await expect(validarLongitudMinima('Passw0rd!')).rejects.toMatchObject({
      status: 422,
      message: 'Contraseña mínimo 12 caracteres',
    });
  });

  it('con el piso por defecto (8), una contraseña de 8 caracteres pasa', async () => {
    vi.mocked(getPasswordMinLength).mockResolvedValue(8);
    await expect(validarLongitudMinima('Passw0r!')).resolves.toBeUndefined();
  });
});

describe('strongPassword — sigue exigiendo el piso fijo independientemente de la config', () => {
  it('rechaza menos de 8 caracteres sin siquiera llegar a validarLongitudMinima', () => {
    expect(() => strongPassword.parse('Pas0!')).toThrow();
  });
});
