import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../src/config/database.js', () => ({
  query: vi.fn().mockResolvedValue({ rows: [] }),
  getClient: vi.fn(),
}));

vi.mock('../src/utils/logger.js', () => ({
  default: { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() },
}));

import { query } from '../src/config/database.js';
import {
  setupTotp,
  enableTotp,
  verifyTotpOrBackup,
  disableTotp,
} from '../src/modules/auth/twoFactor.service.js';

// ── setupTotp() ───────────────────────────────────────────────────────────────

describe('setupTotp()', () => {
  beforeEach(() => vi.clearAllMocks());

  it('genera secret y otpauthUrl cuando 2FA no está activo', async () => {
    query
      .mockResolvedValueOnce({ rows: [{ totp_enabled: false }] })  // SELECT
      .mockResolvedValueOnce({ rows: [] });                         // UPDATE

    const result = await setupTotp('user-1', 'test@iiap.org.co');
    expect(result).toHaveProperty('secret');
    expect(result).toHaveProperty('otpauthUrl');
    expect(typeof result.secret).toBe('string');
    expect(result.otpauthUrl).toMatch(/otpauth:\/\/totp/);
    expect(query).toHaveBeenCalledTimes(2);
  });

  it('lanza 409 si 2FA ya está activado', async () => {
    query.mockResolvedValueOnce({ rows: [{ totp_enabled: true }] });

    await expect(setupTotp('user-1', 'test@iiap.org.co')).rejects.toMatchObject({
      status: 409,
    });
  });

  it('genera secret cuando el usuario no tiene 2FA (rows[0] es undefined)', async () => {
    query
      .mockResolvedValueOnce({ rows: [] })  // usuario no encontrado → totp_enabled undefined
      .mockResolvedValueOnce({ rows: [] }); // UPDATE

    const result = await setupTotp('user-nuevo', 'nuevo@iiap.org.co');
    expect(result.secret).toBeTruthy();
  });
});

// ── enableTotp() ──────────────────────────────────────────────────────────────

describe('enableTotp()', () => {
  beforeEach(() => vi.clearAllMocks());

  it('lanza 400 si no hay totp_secret (setup no iniciado)', async () => {
    query.mockResolvedValueOnce({ rows: [{ totp_secret: null, totp_enabled: false }] });

    await expect(enableTotp('user-1', '123456')).rejects.toMatchObject({ status: 400 });
  });

  it('lanza 409 si 2FA ya está activado', async () => {
    query.mockResolvedValueOnce({ rows: [{ totp_secret: 'JBSWY3DPEHPK3PXP', totp_enabled: true }] });

    await expect(enableTotp('user-1', '123456')).rejects.toMatchObject({ status: 409 });
  });

  it('lanza 401 si el código TOTP es inválido', async () => {
    // Base32 válido pero código incorrecto
    query.mockResolvedValueOnce({
      rows: [{ totp_secret: 'JBSWY3DPEHPK3PXP', totp_enabled: false }],
    });

    await expect(enableTotp('user-1', '000000')).rejects.toMatchObject({ status: 401 });
  });
});

// ── verifyTotpOrBackup() ──────────────────────────────────────────────────────

describe('verifyTotpOrBackup()', () => {
  beforeEach(() => vi.clearAllMocks());

  it('lanza 404 si el usuario no existe', async () => {
    query.mockResolvedValueOnce({ rows: [] });

    await expect(verifyTotpOrBackup('user-inexistente', '123456')).rejects.toMatchObject({
      status: 404,
    });
  });

  it('lanza 401 si el código no es TOTP válido ni backup code', async () => {
    query.mockResolvedValueOnce({
      rows: [{ totp_secret: 'JBSWY3DPEHPK3PXP', totp_backup_codes: [] }],
    });

    await expect(verifyTotpOrBackup('user-1', '000000')).rejects.toMatchObject({ status: 401 });
  });

  it('lanza 401 cuando backup codes es null', async () => {
    query.mockResolvedValueOnce({
      rows: [{ totp_secret: 'JBSWY3DPEHPK3PXP', totp_backup_codes: null }],
    });

    await expect(verifyTotpOrBackup('user-1', '000000')).rejects.toMatchObject({ status: 401 });
  });
});

// ── disableTotp() ─────────────────────────────────────────────────────────────

describe('disableTotp()', () => {
  beforeEach(() => vi.clearAllMocks());

  it('lanza 400 si 2FA no está activado', async () => {
    query.mockResolvedValueOnce({ rows: [] }); // no match WHERE totp_enabled = true

    await expect(disableTotp('user-1', '123456')).rejects.toMatchObject({ status: 400 });
  });

  it('lanza 401 si el código TOTP es inválido', async () => {
    query.mockResolvedValueOnce({
      rows: [{ totp_secret: 'JBSWY3DPEHPK3PXP' }],
    });

    await expect(disableTotp('user-1', '000000')).rejects.toMatchObject({ status: 401 });
  });
});
