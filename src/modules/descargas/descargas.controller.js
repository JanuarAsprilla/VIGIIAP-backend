/**
 * descargas — Proxy de descarga con control de visibilidad y trazabilidad.
 *
 * Problema que resuelve: las URLs de R2 almacenadas en BD son directas (públicas).
 * Cualquiera con el link puede descargar un documento "acreditados" sin autenticarse.
 *
 * Solución: este controlador verifica visibilidad y reenvía el archivo él mismo
 * (streamPrivateFile) en vez de redirigir a una URL prefirmada -- redirigir expone
 * al navegador el host/IP real del almacenamiento S3 (y, en un despliegue sin
 * dominio propio delante, en texto plano). El bucket debe estar configurado como
 * privado en Cloudflare R2 / MinIO.
 *
 * Flujo: GET /api/descargar/mapa/:id?campo=archivo_pdf
 *   1. Buscar recurso en BD
 *   2. Verificar activo + visibilidad vs. usuario
 *   3. Reenviar el archivo directamente (getFileStream + pipe)
 *   4. Registrar descarga en descarga_log (fire-and-forget)
 */
import { query } from '../../config/database.js';
import { isPublicUrl } from '../../config/r2.js';
import { registrarDescarga } from '../../utils/dataCustody.js';
import { streamPrivateFile } from '../../utils/streamFile.js';

/**
 * Verifica si el usuario puede acceder al recurso según su visibilidad.
 * Espeja la lógica de visibilidadPermitida() en los servicios.
 */
function canAccess(visibilidad, user) {
  if (visibilidad === 'publico') return true;
  if (!user || user.tipo === 'visitante' || user.rol === 'visitante') return false;
  if (['admin_sig', 'investigador', 'super_admin'].includes(user.rol)) return true;
  if (visibilidad === 'usuarios') return true;
  return false; // 'acreditados' requiere rol elevado
}

/** GET /api/descargar/mapa/:id?campo=archivo_pdf|archivo_img */
export async function descargarMapa(req, res, next) {
  try {
    const campo = ['archivo_pdf', 'archivo_img'].includes(req.query.campo)
      ? req.query.campo
      : 'archivo_pdf';

    const { rows } = await query(
      `SELECT id, titulo, activo, visibilidad, archivo_pdf_url, archivo_img_url
       FROM mapas WHERE id = $1 AND deleted_at IS NULL`,
      [req.params.id],
    );
    const mapa = rows[0];
    if (!mapa || !mapa.activo) {
      return res.status(404).json({ error: 'Mapa no encontrado' });
    }
    if (!canAccess(mapa.visibilidad, req.user)) {
      return res.status(403).json({ error: 'No tienes acceso a este recurso' });
    }

    const fileUrl = campo === 'archivo_img' ? mapa.archivo_img_url : mapa.archivo_pdf_url;
    if (!fileUrl) {
      return res.status(404).json({ error: 'Archivo no disponible para este mapa' });
    }

    registrarDescarga({
      tipoRecurso:   'mapa',
      recursoId:     mapa.id,
      recursoTitulo: mapa.titulo,
      usuarioId:     req.user?.id     ?? null,
      usuarioEmail:  req.user?.email  ?? null,
      ip:            req.ip,
      archivoUrl:    fileUrl,
    });

    // Archivos públicos (imágenes, thumbnails) se sirven directamente --
    // no llevan credenciales que proteger. Archivos privados (PDFs) se
    // reenvían desde el propio backend (ver streamPrivateFile).
    if (isPublicUrl(fileUrl)) {
      return res.redirect(302, fileUrl);
    }
    await streamPrivateFile(res, next, fileUrl);
  } catch (err) { next(err); }
}

/** GET /api/descargar/documento/:id */
export async function descargarDocumento(req, res, next) {
  try {
    const { rows } = await query(
      `SELECT id, titulo, activo, visibilidad, archivo_url
       FROM documentos WHERE id = $1 AND deleted_at IS NULL`,
      [req.params.id],
    );
    const doc = rows[0];
    if (!doc || !doc.activo) {
      return res.status(404).json({ error: 'Documento no encontrado' });
    }
    if (!canAccess(doc.visibilidad, req.user)) {
      return res.status(403).json({ error: 'No tienes acceso a este recurso' });
    }
    if (!doc.archivo_url) {
      return res.status(404).json({ error: 'Archivo no disponible para este documento' });
    }

    registrarDescarga({
      tipoRecurso:   'documento',
      recursoId:     doc.id,
      recursoTitulo: doc.titulo,
      usuarioId:     req.user?.id     ?? null,
      usuarioEmail:  req.user?.email  ?? null,
      ip:            req.ip,
      archivoUrl:    doc.archivo_url,
    });

    if (isPublicUrl(doc.archivo_url)) {
      return res.redirect(302, doc.archivo_url);
    }
    await streamPrivateFile(res, next, doc.archivo_url);
  } catch (err) { next(err); }
}
