/**
 * biodiversidadEncryption — Cifrado AES-256-GCM de la clave de GBIF en reposo.
 *
 * Mismo mecanismo que geoserverEncryption.js (formato "iv_hex:tag_hex:enc_hex") con una clave propia
 * (BIODIVERSIDAD_ENCRYPTION_KEY): claves separadas por dominio de secreto, para que filtrar una no comprometa la otra.
 * Sin la clave configurada no se puede guardar ni leer ninguna credencial (el resto de la actualización funciona).
 */
import crypto from 'node:crypto';

const ALGO = 'aes-256-gcm';

function getKey() {
  const hex = process.env.BIODIVERSIDAD_ENCRYPTION_KEY ?? '';
  if (!/^[0-9a-f]{64,}$/i.test(hex)) {
    throw Object.assign(
      new Error('BIODIVERSIDAD_ENCRYPTION_KEY no configurada o inválida (mínimo 64 caracteres hexadecimales = 32 bytes)'),
      { status: 503, codigo: 'cifrado_no_configurado' },
    );
  }
  return Buffer.from(hex.slice(0, 64), 'hex');
}

/** ¿Hay una clave de cifrado utilizable? (para avisar en el panel sin lanzar error) */
export function cifradoDisponible() {
  try { getKey(); return true; } catch { return false; }
}

export function cifrarClaveGbif(plano) {
  const key = getKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGO, key, iv);
  const enc = Buffer.concat([cipher.update(plano, 'utf8'), cipher.final()]);
  return `${iv.toString('hex')}:${cipher.getAuthTag().toString('hex')}:${enc.toString('hex')}`;
}

export function descifrarClaveGbif(guardado) {
  const partes = typeof guardado === 'string' ? guardado.split(':') : [];
  if (partes.length !== 3 || !partes.every((p) => /^[0-9a-f]+$/i.test(p))) {
    throw new Error('Credencial con formato inválido');
  }
  const [iv, tag, enc] = partes.map((p) => Buffer.from(p, 'hex'));
  const decipher = crypto.createDecipheriv(ALGO, getKey(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(enc), decipher.final()]).toString('utf8');
}
