/**
 * geoserverEncryption — Cifrado AES-256-GCM para credenciales de conexiones GeoServer en reposo.
 *
 * Mismo mecanismo que totpEncryption.js (AES-256-GCM, formato "iv_hex:tag_hex:enc_hex"), con una
 * clave propia (GEOSERVER_ENCRYPTION_KEY) en vez de reutilizar TOTP_ENCRYPTION_KEY -- claves
 * separadas por dominio de secreto para que filtrar una no comprometa la otra.
 */
import crypto from 'node:crypto';

const ALGO = 'aes-256-gcm';

function getKey() {
  const hex = process.env.GEOSERVER_ENCRYPTION_KEY ?? '';
  if (hex.length < 64) {
    throw Object.assign(
      new Error('GEOSERVER_ENCRYPTION_KEY no configurada o demasiado corta (mínimo 64 hex chars = 32 bytes)'),
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

/** Cifra la contraseña de una conexión GeoServer. Requiere GEOSERVER_ENCRYPTION_KEY. */
export function encryptGeoserverPassword(plaintext) {
  const key = getKey();
  const iv = crypto.randomBytes(12); // 96-bit IV — óptimo para GCM
  const cipher = crypto.createCipheriv(ALGO, key, iv);
  const enc = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag(); // 128-bit auth tag — detecta manipulación
  return `${iv.toString('hex')}:${tag.toString('hex')}:${enc.toString('hex')}`;
}

/** Descifra la contraseña almacenada. Lanza error si el formato es cifrado pero la clave falta/es incorrecta. */
export function decryptGeoserverPassword(stored) {
  if (!stored) return null;
  if (!isEncrypted(stored)) return stored; // plaintext legacy — no debería ocurrir tras el seed inicial
  const [ivHex, tagHex, encHex] = stored.split(':');
  const key = getKey();
  const iv = Buffer.from(ivHex, 'hex');
  const tag = Buffer.from(tagHex, 'hex');
  const encrypted = Buffer.from(encHex, 'hex');
  const decipher = crypto.createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(tag);
  return decipher.update(encrypted).toString('utf8') + decipher.final('utf8');
}
