/**
 * totpEncryption — Cifrado AES-256-GCM para secrets TOTP en reposo.
 *
 * Si la BD es comprometida, el atacante NO puede usar los secrets para
 * generar códigos TOTP válidos sin la clave de cifrado (TOTP_ENCRYPTION_KEY).
 *
 * Formato del ciphertext almacenado: "iv_hex:tag_hex:enc_hex"
 * Si el valor en BD NO tiene ese formato (legacy plaintext), isEncrypted() retorna
 * false y el sistema lo trata como plaintext — compatibilidad hacia atrás durante
 * la migración inicial (pre-lanzamiento con cero usuarios reales).
 */
import crypto from 'node:crypto';

const ALGO = 'aes-256-gcm';

function getKey() {
  const hex = process.env.TOTP_ENCRYPTION_KEY ?? '';
  if (hex.length < 64) {
    throw Object.assign(
      new Error('TOTP_ENCRYPTION_KEY no configurada o demasiado corta (mínimo 64 hex chars = 32 bytes)'),
      { status: 500 },
    );
  }
  return Buffer.from(hex.slice(0, 64), 'hex');
}

/** Retorna true si el valor almacenado en BD tiene el formato cifrado iv:tag:enc */
export function isEncrypted(value) {
  if (!value || typeof value !== 'string') return false;
  const parts = value.split(':');
  return parts.length === 3 && parts.every((p) => /^[0-9a-f]+$/i.test(p));
}

/** Cifra un secret TOTP base32. Requiere TOTP_ENCRYPTION_KEY. */
export function encryptTotpSecret(plaintext) {
  const key = getKey();
  const iv  = crypto.randomBytes(12); // 96-bit IV — óptimo para GCM
  const cipher = crypto.createCipheriv(ALGO, key, iv);
  const enc    = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag    = cipher.getAuthTag(); // 128-bit auth tag — detecta manipulación
  return `${iv.toString('hex')}:${tag.toString('hex')}:${enc.toString('hex')}`;
}

/**
 * Descifra un secret TOTP almacenado en BD.
 * Si el valor es plaintext legacy (sin TOTP_ENCRYPTION_KEY activa), lo retorna tal cual.
 * Lanza error si el valor tiene formato cifrado pero la clave es incorrecta/falta.
 */
export function decryptTotpSecret(stored) {
  if (!stored) return null;
  if (!isEncrypted(stored)) return stored; // plaintext legacy — compatibilidad
  const [ivHex, tagHex, encHex] = stored.split(':');
  const key      = getKey();
  const iv       = Buffer.from(ivHex, 'hex');
  const tag      = Buffer.from(tagHex, 'hex');
  const encrypted = Buffer.from(encHex, 'hex');
  const decipher = crypto.createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(tag);
  return decipher.update(encrypted).toString('utf8') + decipher.final('utf8');
}

/** Retorna true si TOTP_ENCRYPTION_KEY está presente y válida. */
export function isTotpEncryptionEnabled() {
  const hex = process.env.TOTP_ENCRYPTION_KEY ?? '';
  return hex.length >= 64;
}
