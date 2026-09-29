import { Router } from 'express';
import {
  index, show, catalogo, wms, leyenda, consulta, store, update, uploadThumbnail, patchActivo, destroy,
} from './geovisores.controller.js';
import { authenticate, authorize, optionalAuthenticate } from '../../middlewares/auth.js';
import { requireModulo } from '../../middlewares/requireModulo.js';
import { csrfProtection } from '../../middlewares/csrf.js';
import { cacheMiddleware } from '../../middlewares/cache.js';
import { uploadSingle } from '../../middlewares/upload.js';
import { uploadRateLimiter, tileRateLimiter } from '../../middlewares/rateLimiter.js';

const router = Router();
const thumbnailUpload = uploadSingle('thumbnail', 'geovisores/thumbnails', 5, 'thumbnail');

// ─── Lectura pública (filtrada por visibilidad dentro del service) ──────────
router.get('/', cacheMiddleware(120), optionalAuthenticate, index);
router.get('/:slug', cacheMiddleware(300), optionalAuthenticate, show);
router.get('/:slug/capas', cacheMiddleware(300), optionalAuthenticate, catalogo);
// wms/leyenda son proxys binarios hacia GeoServer -- sin cacheMiddleware (asume JSON, ver cache.js).
router.get('/:slug/wms', optionalAuthenticate, tileRateLimiter, wms);
router.get('/:slug/capas/:capaId/leyenda', optionalAuthenticate, tileRateLimiter, leyenda);
router.get('/:slug/capas/:capaId/consulta', optionalAuthenticate, consulta);

// ─── CRUD de geovisores (curaduría de contenido: admin_sig, super_admin siempre pasa) ───────────
router.post('/', authenticate, authorize('admin_sig'), requireModulo('geovisores', 'editar'), csrfProtection, store);
router.patch('/:id', authenticate, authorize('admin_sig'), requireModulo('geovisores', 'editar'), csrfProtection, update);
// csrfProtection ANTES de thumbnailUpload: rechaza la petición forjada antes de parsear el multipart.
router.post('/:id/thumbnail', authenticate, authorize('admin_sig'), requireModulo('geovisores', 'editar'), csrfProtection, uploadRateLimiter, thumbnailUpload, uploadThumbnail);
router.patch('/:id/activo', authenticate, authorize('admin_sig'), requireModulo('geovisores', 'editar'), csrfProtection, patchActivo);
router.delete('/:id', authenticate, authorize('admin_sig'), requireModulo('geovisores', 'editar'), csrfProtection, destroy);

export default router;
