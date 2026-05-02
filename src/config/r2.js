import { S3Client, PutObjectCommand, DeleteObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

const r2 = new S3Client({
  region: 'auto',
  endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
  },
});

const BUCKET = process.env.R2_BUCKET_NAME;
const PUBLIC_URL = process.env.R2_PUBLIC_URL;

/**
 * Sube un archivo a R2 y retorna la URL pública.
 * @param {string} key   - Ruta dentro del bucket (ej: "mapas/2026/mapa.pdf")
 * @param {Buffer} body  - Contenido del archivo
 * @param {string} contentType
 */
export async function uploadFile(key, body, contentType) {
  await r2.send(new PutObjectCommand({
    Bucket: BUCKET,
    Key: key,
    Body: body,
    ContentType: contentType,
  }));
  return `${PUBLIC_URL}/${key}`;
}

/**
 * Elimina un archivo del bucket.
 */
export async function deleteFile(key) {
  await r2.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: key }));
}

/**
 * Genera una URL prefirmada de descarga (GET) con expiración corta.
 * El bucket R2 debe estar configurado como privado para que esto tenga efecto.
 * @param {string} key       - Clave del objeto en R2
 * @param {number} expiresIn - Segundos hasta la expiración (default: 120s)
 */
export async function getPresignedUrl(key, expiresIn = 120) {
  return getSignedUrl(r2, new GetObjectCommand({ Bucket: BUCKET, Key: key }), { expiresIn });
}

/**
 * Extrae la clave R2 de una URL pública almacenada en BD.
 * Soporta tanto URLs con R2_PUBLIC_URL como URLs directas del bucket.
 * @param {string} url
 * @returns {string|null}
 */
export function extractKey(url) {
  if (!url) return null;
  if (PUBLIC_URL && url.startsWith(PUBLIC_URL)) {
    return url.slice(PUBLIC_URL.length).replace(/^\//, '');
  }
  try {
    return new URL(url).pathname.replace(/^\//, '');
  } catch {
    return null;
  }
}

export default r2;
