/**
 * Identificador opaco de los registros con la ubicación reservada (especies CR/EN/VU).
 *
 * El `gbif_id` de esos registros no debe salir de la API: con él, cualquiera consulta api.gbif.org y recupera la
 * coordenada si el conjunto de datos no la generalizó (en una muestra de producción, ~la mitad no lo hacía). En
 * su lugar se entrega `o<token>`: AES-256-GCM con IV sintético (HMAC del id) → determinista, así el mismo registro
 * conserva el mismo id entre peticiones (claves de lista, enlaces compartidos) y solo este servidor puede
 * resolverlo. La clave se deriva de JWT_SECRET con una etiqueta propia; no hay variable nueva que configurar.
 */
import crypto from 'node:crypto';

const ETIQUETA = 'biodiversidad:id-opaco:v1';
export const PATRON_ID_PUBLICO = /^[0-9]{1,20}$/;
export const PATRON_ID_OPACO = /^o[A-Za-z0-9_-]{20,120}$/;

function clave(secreto = process.env.JWT_SECRET) {
  if (!secreto) throw new Error('JWT_SECRET no configurado: no se pueden proteger los identificadores reservados');
  return crypto.createHmac('sha256', secreto).update(ETIQUETA).digest();
}

/** gbif_id → `o<token>` (determinista). */
export function ocultarId(gbifId) {
  const k = clave();
  const iv = crypto.createHmac('sha256', k).update(`iv:${gbifId}`).digest().subarray(0, 12);
  const cipher = crypto.createCipheriv('aes-256-gcm', k, iv, { authTagLength: 16 });
  const cifrado = Buffer.concat([cipher.update(String(gbifId), 'utf8'), cipher.final()]);
  return `o${Buffer.concat([iv, cipher.getAuthTag(), cifrado]).toString('base64url')}`;
}

/** `o<token>` → gbif_id, o null si el token no es válido (manipulado, de otra clave, mal formado). */
export function resolverIdOpaco(token) {
  if (!PATRON_ID_OPACO.test(token ?? '')) return null;
  try {
    const bytes = Buffer.from(token.slice(1), 'base64url');
    if (bytes.length < 12 + 16 + 1) return null;
    const decipher = crypto.createDecipheriv('aes-256-gcm', clave(), bytes.subarray(0, 12), { authTagLength: 16 });
    decipher.setAuthTag(bytes.subarray(12, 28));
    const id = Buffer.concat([decipher.update(bytes.subarray(28)), decipher.final()]).toString('utf8');
    return id.length > 0 ? id : null;
  } catch {
    return null;
  }
}

/** Id que se puede mostrar: el real si la ubicación es pública, el opaco si está reservada. */
export const idVisible = (gbifId, coordenadasOcultas) => (coordenadasOcultas ? ocultarId(gbifId) : String(gbifId));

/** Id que llega por URL → gbif_id real: el opaco se resuelve (null si es inválido); el demás ya lo validó la ruta. */
export function idRealDesdeUrl(valor) {
  return PATRON_ID_OPACO.test(valor ?? '') ? resolverIdOpaco(valor) : (valor ?? null);
}
