import { S3Client, PutObjectCommand, DeleteObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

// S3_ENDPOINT permite apuntar a cualquier almacenamiento compatible con S3
// (MinIO auto-hospedado, etc.) en vez de Cloudflare R2. Si no está definida,
// se usa el endpoint de R2 por defecto — mismo comportamiento de siempre.
const endpoint = process.env.S3_ENDPOINT || `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`;

// MinIO (y la mayoría de despliegues self-hosted) requieren path-style
// (http://host/bucket/key) en vez del virtual-hosted style que usa R2
// (https://bucket.host/key). S3_FORCE_PATH_STYLE lo activa explícitamente.
const forcePathStyle = process.env.S3_FORCE_PATH_STYLE === 'true';

const r2 = new S3Client({
  region: process.env.S3_REGION || 'auto',
  endpoint,
  forcePathStyle,
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
  // No aceptar URLs de otros dominios como keys R2 — podría causar borrado arbitrario de objetos.
  return null;
}

/** Retorna true si la URL pertenece al bucket público. */
export function isPublicUrl(url) {
  return Boolean(PUBLIC_URL && url?.startsWith(PUBLIC_URL));
}

export default r2;
