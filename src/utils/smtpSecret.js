/**
 * smtpSecret — cifrado en reposo (AES-256-GCM) de la contraseña SMTP guardada en la tabla `configuracion`.
 *
 * Clave propia (SMTP_ENCRYPTION_KEY, 64 hex = 32 bytes), separada de las de TOTP, GeoServer y GBIF. Formato
 * `enc1:iv:tag:cifrado` (el prefijo evita confundirlo con una contraseña en claro). Es opcional y compatible
 * hacia atrás: sin clave se guarda y se lee en claro como antes; con clave, lo guardado se cifra y los valores
 * antiguos en claro se siguen leyendo y se re-cifran solos (ver mailer.js).
 */
import crypto from 'node:crypto';

const ALGO = 'aes-256-gcm';
const PREFIJO = 'enc1:';
const AAD = Buffer.from('configuracion:mail_pass');

function claveSiExiste() {
  const hex = process.env.SMTP_ENCRYPTION_KEY ?? '';
  return /^[0-9a-f]{64}$/i.test(hex) ? Buffer.from(hex, 'hex') : null;
}

export const cifradoSmtpDisponible = () => claveSiExiste() !== null;
export const estaCifradaLaClaveSmtp = (valor) => typeof valor === 'string' && valor.startsWith(PREFIJO);

/** Cifra si hay clave configurada; si no, devuelve el valor tal cual (comportamiento anterior). */
export function cifrarSecretoSmtp(claro) {
  const key = claveSiExiste();
  if (!key || !claro || estaCifradaLaClaveSmtp(claro)) return claro;
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGO, key, iv, { authTagLength: 16 });
  cipher.setAAD(AAD);
  const enc = Buffer.concat([cipher.update(claro, 'utf8'), cipher.final()]);
  return `${PREFIJO}${iv.toString('hex')}:${cipher.getAuthTag().toString('hex')}:${enc.toString('hex')}`;
}

/** Descifra un valor `enc1:`; lo que no lo tenga se devuelve igual (legado en claro). Lanza si falta la clave. */
export function descifrarSecretoSmtp(guardado) {
  if (!estaCifradaLaClaveSmtp(guardado)) return guardado;
  const key = claveSiExiste();
  if (!key) throw new Error('SMTP_ENCRYPTION_KEY no configurada: no se puede descifrar la contraseña SMTP');
  const [ivHex, tagHex, encHex] = guardado.slice(PREFIJO.length).split(':');
  if (!ivHex || !tagHex || !encHex || tagHex.length !== 32) throw new Error('Contraseña SMTP cifrada con formato inválido');
  const decipher = crypto.createDecipheriv(ALGO, key, Buffer.from(ivHex, 'hex'), { authTagLength: 16 });
  decipher.setAAD(AAD);
  decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
  return Buffer.concat([decipher.update(Buffer.from(encHex, 'hex')), decipher.final()]).toString('utf8');
}
