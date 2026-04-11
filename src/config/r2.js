import { S3Client, PutObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
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
 * Genera una URL prefirmada para descarga temporal (ej: documentos privados).
 */
export async function getPresignedUrl(key, expiresIn = 3600) {
  return getSignedUrl(r2, new PutObjectCommand({ Bucket: BUCKET, Key: key }), { expiresIn });
}

export default r2;
