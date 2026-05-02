import { S3Client, PutObjectCommand, DeleteObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

const r2 = new S3Client({
  region: 'auto',
  endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId:     process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
  },
});

// Bucket privado — PDFs, documentos (acceso solo por URL prefirmada)
const PRIVATE_BUCKET = process.env.R2_BUCKET_NAME;
const PRIVATE_URL    = process.env.R2_PUBLIC_URL;

// Bucket público — thumbnails, imágenes, fotos de noticias (URL directa)
const PUBLIC_BUCKET  = process.env.R2_PUBLIC_BUCKET_NAME;
const PUBLIC_URL     = process.env.R2_PUBLIC_BUCKET_URL;

/**
 * Sube un archivo a R2.
 * @param {string}  key        - Ruta dentro del bucket
 * @param {Buffer}  body
 * @param {string}  contentType
 * @param {boolean} isPublic   - true → bucket público (thumbnails/imágenes)
 */
export async function uploadFile(key, body, contentType, isPublic = false) {
  const bucket  = isPublic ? PUBLIC_BUCKET  : PRIVATE_BUCKET;
  const baseUrl = isPublic ? PUBLIC_URL     : PRIVATE_URL;
  await r2.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: body, ContentType: contentType }));
  return `${baseUrl}/${key}`;
}

/**
 * Elimina un archivo identificado por su URL completa almacenada en BD.
 * Determina automáticamente en qué bucket está según el prefijo de la URL.
 */
export async function deleteFileByUrl(url) {
  if (!url) return;
  const isPublic = PUBLIC_URL && url.startsWith(PUBLIC_URL);
  const bucket   = isPublic ? PUBLIC_BUCKET : PRIVATE_BUCKET;
  const key      = extractKey(url);
  if (!key) return;
  await r2.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
}

/** Mantiene compatibilidad con código existente que pasa la key directamente. */
export async function deleteFile(key) {
  if (!key) return;
  await r2.send(new DeleteObjectCommand({ Bucket: PRIVATE_BUCKET, Key: key }));
}

/**
 * Genera una URL prefirmada de descarga (GET) válida por expiresIn segundos.
 * Usar solo para archivos del bucket privado.
 */
export async function getPresignedUrl(key, expiresIn = 120) {
  return getSignedUrl(r2, new GetObjectCommand({ Bucket: PRIVATE_BUCKET, Key: key }), { expiresIn });
}

/**
 * Extrae la clave R2 de una URL almacenada en BD.
 * Soporta URLs de ambos buckets (público y privado).
 */
export function extractKey(url) {
  if (!url) return null;
  if (PRIVATE_URL && url.startsWith(PRIVATE_URL)) {
    return url.slice(PRIVATE_URL.length).replace(/^\//, '');
  }
  if (PUBLIC_URL && url.startsWith(PUBLIC_URL)) {
    return url.slice(PUBLIC_URL.length).replace(/^\//, '');
  }
  try {
    return new URL(url).pathname.replace(/^\//, '');
  } catch {
    return null;
  }
}

/** Retorna true si la URL pertenece al bucket público. */
export function isPublicUrl(url) {
  return Boolean(PUBLIC_URL && url?.startsWith(PUBLIC_URL));
}

export default r2;
