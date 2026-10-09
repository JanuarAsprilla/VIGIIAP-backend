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
  // Defensa en profundidad además del saneo en origen (solicitudes.service.js
  // ya sanea con sanitizeFilename antes de guardar) -- este sink es
  // compartido con otros callers presentes y futuros, así que nunca confía
  // únicamente en que el nombre ya llegue limpio. Comillas rotas el
  // parámetro del header; Node lanza si el valor tiene CR/LF.
  const nombreSeguro = String(filename || key.split('/').pop())
    // eslint-disable-next-line no-control-regex
    .replace(/[\x00-\x1f\x7f]/g, '')
    .replace(/"/g, "'");
  res.setHeader('Content-Disposition', `inline; filename="${nombreSeguro}"`);
  // private: nunca un caché compartido/CDN, solo el navegador de quien ya
  // pasó la autorización de esta ruta. max-age corto (5 min) porque el
  // control de acceso se revalida en cada request real -- una ventana larga
  // dejaría a un usuario con acceso revocado seguir viendo su copia cacheada
  // más tiempo del razonable. Sin esto, re-abrir el mismo documento (ej.
  // volver atrás y adelante) volvía a bajar el archivo completo cada vez.
  res.setHeader('Cache-Control', 'private, max-age=300');
  stream.on('error', (err) => {
    if (res.headersSent) { res.destroy(err); return; }
    next(err);
  });
  stream.pipe(res);
}
