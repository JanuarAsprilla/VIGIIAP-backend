/**
 * Reenvía un archivo del bucket privado S3/R2 al cliente vía stream, en vez
 * de redirigir o devolver una URL prefirmada al navegador. Una URL prefirmada
 * apunta directo a S3_ENDPOINT -- el host/IP real del almacenamiento, sin
 * TLS en un despliegue self-hosted sin dominio propio delante -- así que
 * nunca debe llegar al cliente. Compartido entre descargas.controller.js
 * (mapas/documentos) y solicitudes.controller.js (archivos adjuntos).
 */
import { getFileStream, extractKey } from '../config/r2.js';

export async function streamPrivateFile(res, next, fileUrl, filename) {
  const key = extractKey(fileUrl);
  if (!key) {
    res.status(500).json({ error: 'No se pudo resolver la clave del archivo' });
    return;
  }
  const { stream, contentType, contentLength } = await getFileStream(key);
  res.setHeader('Content-Type', contentType || 'application/octet-stream');
  if (contentLength) res.setHeader('Content-Length', String(contentLength));
  res.setHeader('Content-Disposition', `inline; filename="${filename || key.split('/').pop()}"`);
  stream.on('error', (err) => {
    if (res.headersSent) { res.destroy(err); return; }
    next(err);
  });
  stream.pipe(res);
}
