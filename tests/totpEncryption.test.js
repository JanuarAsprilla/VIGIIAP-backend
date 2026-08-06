/**
 * Tests para utils/totpEncryption.js
 * Foco: isEncrypted(), encryptTotpSecret(), decryptTotpSecret(), isTotpEncryptionEnabled()
 * y los errores lanzados por getKey() cuando TOTP_ENCRYPTION_KEY falta o es inválida.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  isEncrypted,
  encryptTotpSecret,
  decryptTotpSecret,
  isTotpEncryptionEnabled,
} from '../src/utils/totpEncryption.js';

const VALID_KEY   = 'a'.repeat(64);
const OTHER_KEY   = 'b'.repeat(64);

beforeEach(() => {
  delete process.env.TOTP_ENCRYPTION_KEY;
});

afterEach(() => {
  delete process.env.TOTP_ENCRYPTION_KEY;
});

// ─── isEncrypted() ────────────────────────────────────────────────────────────

describe('isEncrypted()', () => {
  it('retorna false para null', () => {
    expect(isEncrypted(null)).toBe(false);
  });

  it('retorna false para undefined', () => {
    expect(isEncrypted(undefined)).toBe(false);
  });

  it('retorna false para valores que no son string', () => {
    expect(isEncrypted(12345)).toBe(false);
  });

  it('retorna false para string vacío', () => {
    expect(isEncrypted('')).toBe(false);
  });

  it('retorna false cuando no tiene exactamente 3 partes separadas por ":"', () => {
    expect(isEncrypted('abc123')).toBe(false);
    expect(isEncrypted('abc:def')).toBe(false);
    expect(isEncrypted('a:b:c:d')).toBe(false);
  });

  it('retorna false cuando alguna parte contiene caracteres no hexadecimales', () => {
    expect(isEncrypted('zz:aabb:ccdd')).toBe(false);
  });

  it('retorna true para un valor con formato iv:tag:enc en hexadecimal', () => {
    expect(isEncrypted('aabbcc:ddeeff:00112233')).toBe(true);
  });
});

// ─── encryptTotpSecret() ──────────────────────────────────────────────────────

describe('encryptTotpSecret()', () => {
  it('lanza error 500 cuando TOTP_ENCRYPTION_KEY no está configurada', () => {
    expect(() => encryptTotpSecret('JBSWY3DPEHPK3PXP')).toThrow(
      /TOTP_ENCRYPTION_KEY no configurada/,
    );
    try {
      encryptTotpSecret('JBSWY3DPEHPK3PXP');
    } catch (err) {
      expect(err.status).toBe(500);
    }
  });

  it('lanza error cuando TOTP_ENCRYPTION_KEY es más corta de 64 chars hex', () => {
    process.env.TOTP_ENCRYPTION_KEY = 'a'.repeat(32);
    expect(() => encryptTotpSecret('JBSWY3DPEHPK3PXP')).toThrow(
      /demasiado corta/,
    );
  });

  it('cifra un secret y retorna el formato iv:tag:enc en hex', () => {
    process.env.TOTP_ENCRYPTION_KEY = VALID_KEY;
    const result = encryptTotpSecret('JBSWY3DPEHPK3PXP');
    expect(isEncrypted(result)).toBe(true);
    expect(result.split(':')).toHaveLength(3);
  });

  it('produce ciphertexts distintos para el mismo plaintext (IV aleatorio)', () => {
    process.env.TOTP_ENCRYPTION_KEY = VALID_KEY;
    const a = encryptTotpSecret('JBSWY3DPEHPK3PXP');
    const b = encryptTotpSecret('JBSWY3DPEHPK3PXP');
    expect(a).not.toBe(b);
  });
});

// ─── decryptTotpSecret() ──────────────────────────────────────────────────────

describe('decryptTotpSecret()', () => {
  it('retorna null cuando el valor almacenado es falsy', () => {
    expect(decryptTotpSecret(null)).toBeNull();
    expect(decryptTotpSecret(undefined)).toBeNull();
    expect(decryptTotpSecret('')).toBeNull();
  });

  it('retorna el valor tal cual si es plaintext legacy (no cifrado)', () => {
    expect(decryptTotpSecret('JBSWY3DPEHPK3PXP')).toBe('JBSWY3DPEHPK3PXP');
  });

  it('descifra correctamente un secret cifrado con la misma clave (round-trip)', () => {
    process.env.TOTP_ENCRYPTION_KEY = VALID_KEY;
    const plaintext = 'JBSWY3DPEHPK3PXP';
    const encrypted  = encryptTotpSecret(plaintext);

    expect(decryptTotpSecret(encrypted)).toBe(plaintext);
  });

  it('lanza error si el valor tiene formato cifrado pero falta la clave', () => {
    process.env.TOTP_ENCRYPTION_KEY = VALID_KEY;
    const encrypted = encryptTotpSecret('JBSWY3DPEHPK3PXP');
    delete process.env.TOTP_ENCRYPTION_KEY;

    expect(() => decryptTotpSecret(encrypted)).toThrow(
      /TOTP_ENCRYPTION_KEY no configurada/,
    );
  });

  it('lanza error si se intenta descifrar con una clave distinta a la usada para cifrar', () => {
    process.env.TOTP_ENCRYPTION_KEY = VALID_KEY;
    const encrypted = encryptTotpSecret('JBSWY3DPEHPK3PXP');

    process.env.TOTP_ENCRYPTION_KEY = OTHER_KEY;
    expect(() => decryptTotpSecret(encrypted)).toThrow();
  });

  it('lanza error si el ciphertext fue manipulado (auth tag inválido)', () => {
    process.env.TOTP_ENCRYPTION_KEY = VALID_KEY;
    const encrypted = encryptTotpSecret('JBSWY3DPEHPK3PXP');
    const [iv, tag, enc] = encrypted.split(':');
    const tampered = `${iv}:${tag}:${enc.slice(0, -2)}${enc.slice(-2) === '00' ? '11' : '00'}`;

    expect(() => decryptTotpSecret(tampered)).toThrow();
  });
});

// ─── isTotpEncryptionEnabled() ────────────────────────────────────────────────

describe('isTotpEncryptionEnabled()', () => {
  it('retorna false cuando TOTP_ENCRYPTION_KEY no está definida', () => {
    expect(isTotpEncryptionEnabled()).toBe(false);
  });

  it('retorna false cuando TOTP_ENCRYPTION_KEY es más corta de 64 chars', () => {
    process.env.TOTP_ENCRYPTION_KEY = 'a'.repeat(10);
    expect(isTotpEncryptionEnabled()).toBe(false);
  });

  it('retorna true cuando TOTP_ENCRYPTION_KEY tiene al menos 64 chars hex', () => {
    process.env.TOTP_ENCRYPTION_KEY = VALID_KEY;
    expect(isTotpEncryptionEnabled()).toBe(true);
  });
});
