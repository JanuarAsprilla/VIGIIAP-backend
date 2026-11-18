/**
 * biodiversidadEncryption — Cifrado AES-256-GCM de la clave de GBIF en reposo.
 *
 * Mismo mecanismo que geoserverEncryption.js (formato "v1:iv_hex:tag_hex:enc_hex"; se sigue leyendo el anterior sin prefijo "iv_hex:tag_hex:enc_hex") con una clave propia
 * (BIODIVERSIDAD_ENCRYPTION_KEY): claves separadas por dominio de secreto, para que filtrar una no comprometa la otra.
 * El AAD (usuario_id) no está ligado: hacerlo exigiría migrar los datos ya cifrados (pendiente).
 * Sin la clave configurada no se puede guardar ni leer ninguna credencial (el resto de la actualización funciona).
 */
import crypto from 'node:crypto';
import logger from './logger.js';

const ALGO = 'aes-256-gcm';
const VERSION = 'v1';
const HEX_CLAVE = 64;
let avisoLongitud = false;

function getKey() {
  const hex = process.env.BIODIVERSIDAD_ENCRYPTION_KEY ?? '';
  if (!/^[0-9a-f]+$/i.test(hex) || hex.length < HEX_CLAVE) {
    throw Object.assign(
      new Error(`BIODIVERSIDAD_ENCRYPTION_KEY no configurada, no hexadecimal o corta (${hex.length} de ${HEX_CLAVE} caracteres = 32 bytes)`),
      { status: 503, codigo: 'cifrado_no_configurado' },
    );
  }
  if (hex.length > HEX_CLAVE && !avisoLongitud) {
    avisoLongitud = true;
    logger.warn(`BIODIVERSIDAD_ENCRYPTION_KEY tiene ${hex.length} caracteres: solo se usan los primeros ${HEX_CLAVE}; deje exactamente ${HEX_CLAVE}.`);
  }
  return Buffer.from(hex.slice(0, HEX_CLAVE), 'hex');
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
  return `${VERSION}:${iv.toString('hex')}:${cipher.getAuthTag().toString('hex')}:${enc.toString('hex')}`;
}

export function descifrarClaveGbif(guardado) {
  let partes = typeof guardado === 'string' ? guardado.split(':') : [];
  if (partes.length === 4 && partes[0] === VERSION) partes = partes.slice(1);
  if (partes.length !== 3 || !partes.every((p) => /^[0-9a-f]+$/i.test(p))) {
    throw new Error('Credencial con formato inválido');
  }
  const [iv, tag, enc] = partes.map((p) => Buffer.from(p, 'hex'));
  const decipher = crypto.createDecipheriv(ALGO, getKey(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(enc), decipher.final()]).toString('utf8');
}
