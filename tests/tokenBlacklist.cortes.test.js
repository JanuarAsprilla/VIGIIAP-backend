import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../src/config/database.js', () => ({
  query: vi.fn().mockResolvedValue({ rows: [] }),
  getClient: vi.fn(),
}));
vi.mock('../src/utils/logger.js', () => ({
  default: { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() },
}));

import { query } from '../src/config/database.js';
import { invalidarAccesoDeUsuario, isUserSessionRevoked, loadBlacklist, sincronizarRevocados } from '../src/utils/tokenBlacklist.js';

const ahora = () => Math.floor(Date.now() / 1000);

beforeEach(() => {
  vi.clearAllMocks();
  query.mockResolvedValue({ rows: [] });
});

describe('isUserSessionRevoked()', () => {
  it('sin corte registrado ningún token se rechaza', () => {
    expect(isUserSessionRevoked({ id: 'sin-corte', iat: 1 })).toBe(false);
  });

  it('un token sin identidad de cuenta (visitante) nunca se ve afectado', () => {
    expect(isUserSessionRevoked({ tipo: 'visitante', visitanteId: 'v-1', iat: 1 })).toBe(false);
    expect(isUserSessionRevoked(undefined)).toBe(false);
  });

  it('rechaza lo emitido antes del corte y acepta lo emitido en el mismo segundo o después', async () => {
    await invalidarAccesoDeUsuario('u-corte');
    const corte = ahora();
    expect(isUserSessionRevoked({ id: 'u-corte', iat: corte - 5 })).toBe(true);
    expect(isUserSessionRevoked({ id: 'u-corte', iat: corte })).toBe(false);
    expect(isUserSessionRevoked({ id: 'u-corte', iat: corte + 60 })).toBe(false);
  });

  it('con corte, un token sin fecha de emisión no se puede validar y se rechaza', async () => {
    await invalidarAccesoDeUsuario('u-sin-iat');
    expect(isUserSessionRevoked({ id: 'u-sin-iat' })).toBe(true);
  });

  it('el corte de una cuenta no afecta a otra', async () => {
    await invalidarAccesoDeUsuario('u-a');
    expect(isUserSessionRevoked({ id: 'u-b', iat: 1 })).toBe(false);
  });
});

describe('invalidarAccesoDeUsuario()', () => {
  it('guarda el corte en la base con un upsert', async () => {
    await invalidarAccesoDeUsuario('u-db');
    const [sql, params] = query.mock.calls[0];
    expect(sql).toMatch(/INSERT INTO sesiones_invalidadas/i);
    expect(sql).toMatch(/ON CONFLICT \(usuario_id\) DO UPDATE/i);
    expect(params[0]).toBe('u-db');
  });

  it('si la base falla no lanza y el corte sigue valiendo en memoria', async () => {
    query.mockRejectedValueOnce(new Error('conexión caída'));
    await expect(invalidarAccesoDeUsuario('u-falla')).resolves.toBeUndefined();
    expect(isUserSessionRevoked({ id: 'u-falla', iat: ahora() - 10 })).toBe(true);
  });
});

describe('carga y sincronización de cortes', () => {
  it('al arrancar incorpora los cortes guardados', async () => {
    query
      .mockResolvedValueOnce({ rows: [] }) // DELETE tokens vencidos
      .mockResolvedValueOnce({ rows: [] }) // SELECT tokens
      .mockResolvedValueOnce({ rows: [] }) // DELETE cortes viejos
      .mockResolvedValueOnce({ rows: [{ usuario_id: 'u-carga', corte: String(ahora()) }] });
    await loadBlacklist();
    expect(isUserSessionRevoked({ id: 'u-carga', iat: ahora() - 30 })).toBe(true);
  });

  it('la sincronización trae los cortes que otra instancia registró', async () => {
    query
      .mockResolvedValueOnce({ rows: [] }) // tokens revocados
      .mockResolvedValueOnce({ rows: [{ usuario_id: 'u-otra-instancia', corte: String(ahora()) }] });
    await sincronizarRevocados();
    expect(isUserSessionRevoked({ id: 'u-otra-instancia', iat: ahora() - 30 })).toBe(true);
  });

  it('un corte más antiguo que el ya conocido no lo retrasa', async () => {
    await invalidarAccesoDeUsuario('u-no-retrocede');
    const corte = ahora();
    query
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ usuario_id: 'u-no-retrocede', corte: String(corte - 500) }] });
    await sincronizarRevocados();
    expect(isUserSessionRevoked({ id: 'u-no-retrocede', iat: corte - 100 })).toBe(true);
  });
});
