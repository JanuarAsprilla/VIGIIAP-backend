import { S3Client, PutObjectCommand, DeleteObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';

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
  // El público (thumbnails/imágenes) se sirve directo desde el almacenamiento,
  // sin pasar por el backend -- a diferencia del privado, acá no hay ningún
  // punto donde poner un header de caché aparte, así que se fija como
  // metadata del propio objeto. Cada key es única (timestamp + UUID, ver
  // middlewares/upload.js) -- nunca se reescribe una URL existente, así que
  // "immutable" + un año es seguro: editar un thumbnail genera una URL nueva,
  // nunca cambia el contenido detrás de una ya cacheada.
  const cacheControl = isPublic ? 'public, max-age=31536000, immutable' : undefined;
  await r2.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: body, ContentType: contentType, CacheControl: cacheControl }));
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
 * Descarga un objeto del bucket privado y devuelve su stream directamente,
 * para que el backend lo reenvíe al cliente en vez de redirigirlo a una URL
 * prefirmada. Así el navegador solo ve el dominio del propio API -- nunca la
 * IP/host real del almacenamiento S3, que una URL prefirmada sí revela.
 */
export async function getFileStream(key) {
  const { Body, ContentType, ContentLength } = await r2.send(
    new GetObjectCommand({ Bucket: PRIVATE_BUCKET, Key: key }),
  );
  return { stream: Body, contentType: ContentType, contentLength: ContentLength };
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
