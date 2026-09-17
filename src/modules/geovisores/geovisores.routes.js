import { Router } from 'express';
import {
  index, show, catalogo, wms, leyenda, consulta, store, update, patchActivo, destroy,
} from './geovisores.controller.js';
import { authenticate, authorize, optionalAuthenticate } from '../../middlewares/auth.js';
import { csrfProtection } from '../../middlewares/csrf.js';
import { cacheMiddleware } from '../../middlewares/cache.js';

const router = Router();

// ─── Lectura pública (filtrada por visibilidad dentro del service) ──────────
router.get('/', cacheMiddleware(120), optionalAuthenticate, index);
router.get('/:slug', cacheMiddleware(300), optionalAuthenticate, show);
router.get('/:slug/capas', cacheMiddleware(300), optionalAuthenticate, catalogo);
// wms/leyenda son proxys binarios hacia GeoServer -- sin cacheMiddleware (asume JSON, ver cache.js).
router.get('/:slug/wms', optionalAuthenticate, wms);
router.get('/:slug/capas/:capaId/leyenda', optionalAuthenticate, leyenda);
router.get('/:slug/capas/:capaId/consulta', optionalAuthenticate, consulta);

// ─── CRUD de geovisores (curaduría de contenido: admin_sig, super_admin siempre pasa) ───────────
router.post('/', authenticate, authorize('admin_sig'), csrfProtection, store);
router.patch('/:id', authenticate, authorize('admin_sig'), csrfProtection, update);
router.patch('/:id/activo', authenticate, authorize('admin_sig'), csrfProtection, patchActivo);
router.delete('/:id', authenticate, authorize('admin_sig'), csrfProtection, destroy);

export default router;
