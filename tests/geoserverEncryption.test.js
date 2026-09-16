import { describe, it, expect, beforeAll } from 'vitest';
import {
  encryptGeoserverPassword,
  decryptGeoserverPassword,
  isEncrypted,
} from '../src/utils/geoserverEncryption.js';

beforeAll(() => {
  process.env.GEOSERVER_ENCRYPTION_KEY = 'a'.repeat(64); // 32 bytes hex válidos para pruebas
});

describe('geoserverEncryption', () => {
  it('cifra y descifra una contraseña de vuelta al valor original', () => {
    const cifrado = encryptGeoserverPassword('super-secreta-123');
    expect(cifrado).not.toBe('super-secreta-123');
    expect(decryptGeoserverPassword(cifrado)).toBe('super-secreta-123');
  });

  it('produce un ciphertext distinto cada vez (IV aleatorio)', () => {
    const a = encryptGeoserverPassword('misma-contraseña');
    const b = encryptGeoserverPassword('misma-contraseña');
    expect(a).not.toBe(b);
  });

  it('isEncrypted reconoce el formato iv:tag:enc y rechaza texto plano', () => {
    const cifrado = encryptGeoserverPassword('algo');
    expect(isEncrypted(cifrado)).toBe(true);
    expect(isEncrypted('texto-plano-cualquiera')).toBe(false);
    expect(isEncrypted(null)).toBe(false);
  });

  it('decryptGeoserverPassword retorna texto plano legacy sin cifrar tal cual (compatibilidad)', () => {
    expect(decryptGeoserverPassword('plaintext-legacy')).toBe('plaintext-legacy');
  });

  it('lanza un error claro si GEOSERVER_ENCRYPTION_KEY falta o es demasiado corta', () => {
    const original = process.env.GEOSERVER_ENCRYPTION_KEY;
    process.env.GEOSERVER_ENCRYPTION_KEY = 'corta';
    expect(() => encryptGeoserverPassword('x')).toThrow(/GEOSERVER_ENCRYPTION_KEY/);
    process.env.GEOSERVER_ENCRYPTION_KEY = original;
  });
});
