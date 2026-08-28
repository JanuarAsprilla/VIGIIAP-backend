import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as OTPAuth from 'otpauth';
import bcrypt from 'bcryptjs';

vi.mock('../src/config/database.js', () => ({
  query: vi.fn().mockResolvedValue({ rows: [] }),
  getClient: vi.fn(),
}));

vi.mock('../src/utils/logger.js', () => ({
  default: { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() },
}));

import { query, getClient } from '../src/config/database.js';
import {
  setupTotp,
  enableTotp,
  verifyTotpOrBackup,
  disableTotp,
} from '../src/modules/auth/twoFactor.service.js';

/** Genera un secret base32 real y un código TOTP válido para ese secret. */
function generateValidTotp() {
  const secret = new OTPAuth.Secret();
  const secretB32 = secret.base32;
  const totp = new OTPAuth.TOTP({ secret, period: 30 });
  return { secretB32, code: totp.generate() };
}

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

  describe('con TOTP_ENCRYPTION_KEY configurada', () => {
    const originalKey = process.env.TOTP_ENCRYPTION_KEY;

    beforeEach(() => {
      process.env.TOTP_ENCRYPTION_KEY = 'a'.repeat(64);
    });

    afterEach(() => {
      if (originalKey === undefined) delete process.env.TOTP_ENCRYPTION_KEY;
      else process.env.TOTP_ENCRYPTION_KEY = originalKey;
    });

    it('cifra el secret antes de guardarlo (rama isTotpEncryptionEnabled=true)', async () => {
      query
        .mockResolvedValueOnce({ rows: [{ totp_enabled: false }] })
        .mockResolvedValueOnce({ rows: [] });

      const result = await setupTotp('user-1', 'test@iiap.org.co');
      const updateCall = query.mock.calls[1];
      expect(updateCall[1][0]).not.toBe(result.secret); // el valor guardado está cifrado
      expect(updateCall[1][0]).toMatch(/^[0-9a-f]+:[0-9a-f]+:[0-9a-f]+$/);
    });
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

  it('activa 2FA y retorna 8 backup codes con código TOTP válido', async () => {
    const { secretB32, code } = generateValidTotp();
    query
      .mockResolvedValueOnce({ rows: [{ totp_secret: secretB32, totp_enabled: false }] })
      .mockResolvedValueOnce({ rows: [] }); // UPDATE

    const result = await enableTotp('user-1', code);
    expect(result.backupCodes).toHaveLength(8);
    result.backupCodes.forEach((c) => expect(typeof c).toBe('string'));
    const updateCall = query.mock.calls[1];
    expect(updateCall[0]).toContain('totp_enabled = true');
    expect(updateCall[1][0]).toHaveLength(8);
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

  it('retorna true y persiste el contador cuando el código TOTP es válido', async () => {
    const { secretB32, code } = generateValidTotp();
    query
      .mockResolvedValueOnce({
        rows: [{ totp_secret: secretB32, totp_backup_codes: [], totp_last_counter: null }],
      })
      .mockResolvedValueOnce({ rows: [] }); // UPDATE totp_last_counter

    const result = await verifyTotpOrBackup('user-1', code);
    expect(result).toBe(true);
    expect(query).toHaveBeenCalledTimes(2);
    expect(query.mock.calls[1][0]).toContain('totp_last_counter');
  });

  it('rechaza el código TOTP como replay cuando el contador ya fue usado', async () => {
    const { secretB32, code } = generateValidTotp();
    // Contador futuro absurdamente alto → currentCounter <= lastCounter siempre
    query.mockResolvedValueOnce({
      rows: [{ totp_secret: secretB32, totp_backup_codes: [], totp_last_counter: 99999999999 }],
    });

    await expect(verifyTotpOrBackup('user-1', code)).rejects.toMatchObject({ status: 401 });
  });

  it('lanza 401 sin llegar a abrir transacción cuando el secret es inválido y no hay backup codes', async () => {
    query.mockResolvedValueOnce({
      rows: [{ totp_secret: 'no-es-base32-valido!!!', totp_backup_codes: [], totp_last_counter: null }],
    });

    await expect(verifyTotpOrBackup('user-1', '123456')).rejects.toMatchObject({ status: 401 });
    expect(getClient).not.toHaveBeenCalled();
  });

  it('consume un backup code válido con SELECT FOR UPDATE y retorna true', async () => {
    const rawBackupCode = 'abc123def4';
    const hashedBackupCode = await bcrypt.hash(rawBackupCode, 10);
    query.mockResolvedValueOnce({
      rows: [{
        totp_secret: 'JBSWY3DPEHPK3PXP',
        totp_backup_codes: [hashedBackupCode],
        totp_last_counter: null,
      }],
    });

    const mockClient = {
      query: vi.fn()
        .mockResolvedValueOnce({}) // BEGIN
        .mockResolvedValueOnce({ rows: [{ totp_backup_codes: [hashedBackupCode] }] }) // SELECT FOR UPDATE
        .mockResolvedValueOnce({}) // UPDATE (consume code)
        .mockResolvedValueOnce({}), // COMMIT
      release: vi.fn(),
    };
    getClient.mockResolvedValueOnce(mockClient);

    const result = await verifyTotpOrBackup('user-1', rawBackupCode);
    expect(result).toBe(true);
    expect(mockClient.query).toHaveBeenCalledWith('COMMIT');
    expect(mockClient.release).toHaveBeenCalled();
  });

  it('hace rollback y lanza 401 si el usuario desaparece entre el chequeo inicial y el SELECT FOR UPDATE (carrera)', async () => {
    const hashedBackupCode = await bcrypt.hash('abc123def4', 10);
    query.mockResolvedValueOnce({
      rows: [{
        totp_secret: 'JBSWY3DPEHPK3PXP',
        totp_backup_codes: [hashedBackupCode],
        totp_last_counter: null,
      }],
    });

    const mockClient = {
      query: vi.fn()
        .mockResolvedValueOnce({}) // BEGIN
        .mockResolvedValueOnce({ rows: [] }) // SELECT FOR UPDATE — el usuario ya no existe
        .mockResolvedValueOnce({}), // ROLLBACK
      release: vi.fn(),
    };
    getClient.mockResolvedValueOnce(mockClient);

    await expect(verifyTotpOrBackup('user-1', 'abc123def4')).rejects.toMatchObject({ status: 401 });
    expect(mockClient.query).toHaveBeenCalledWith('ROLLBACK');
  });

  it('hace rollback y lanza 401 cuando el backup code no coincide con ninguno', async () => {
    const hashedBackupCode = await bcrypt.hash('otro-code', 10);
    query.mockResolvedValueOnce({
      rows: [{
        totp_secret: 'JBSWY3DPEHPK3PXP',
        totp_backup_codes: [hashedBackupCode],
        totp_last_counter: null,
      }],
    });

    const mockClient = {
      query: vi.fn()
        .mockResolvedValueOnce({}) // BEGIN
        .mockResolvedValueOnce({ rows: [{ totp_backup_codes: [hashedBackupCode] }] }) // SELECT FOR UPDATE
        .mockResolvedValueOnce({}), // ROLLBACK
      release: vi.fn(),
    };
    getClient.mockResolvedValueOnce(mockClient);

    await expect(verifyTotpOrBackup('user-1', 'codigo-que-no-existe')).rejects.toMatchObject({ status: 401 });
    expect(mockClient.query).toHaveBeenCalledWith('ROLLBACK');
    expect(mockClient.release).toHaveBeenCalled();
  });

  it('hace rollback y relanza el error original cuando la transacción falla', async () => {
    query.mockResolvedValueOnce({
      rows: [{
        totp_secret: 'JBSWY3DPEHPK3PXP',
        totp_backup_codes: ['algún-hash'],
        totp_last_counter: null,
      }],
    });

    const dbError = new Error('conexión perdida');
    const mockClient = {
      query: vi.fn()
        .mockResolvedValueOnce({}) // BEGIN
        .mockRejectedValueOnce(dbError) // SELECT FOR UPDATE falla
        .mockRejectedValueOnce(new Error('rollback también falla')), // ROLLBACK falla → catch silencioso
      release: vi.fn(),
    };
    getClient.mockResolvedValueOnce(mockClient);

    await expect(verifyTotpOrBackup('user-1', 'cualquier-codigo')).rejects.toThrow('conexión perdida');
    expect(mockClient.release).toHaveBeenCalled();
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

  it('lanza 401 cuando el secret almacenado es inválido (excepción en checkTotp)', async () => {
    query.mockResolvedValueOnce({
      rows: [{ totp_secret: 'no-es-base32-valido!!!' }],
    });

    await expect(disableTotp('user-1', '123456')).rejects.toMatchObject({ status: 401 });
  });

  it('desactiva 2FA y limpia los campos totp cuando el código es válido', async () => {
    const { secretB32, code } = generateValidTotp();
    query
      .mockResolvedValueOnce({ rows: [{ totp_secret: secretB32 }] })
      .mockResolvedValueOnce({ rows: [] }); // UPDATE

    await disableTotp('user-1', code);
    expect(query).toHaveBeenCalledTimes(2);
    expect(query.mock.calls[1][0]).toContain('totp_enabled = false');
  });
});
