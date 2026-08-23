import { Router } from 'express';
import { index, create, upsertThumbnail, destroy } from './categorias.controller.js';
import { authenticate, authorize } from '../../middlewares/auth.js';
import { csrfProtection } from '../../middlewares/csrf.js';
import { uploadSingle } from '../../middlewares/upload.js';
import { cacheMiddleware } from '../../middlewares/cache.js';

const router = Router();

// GET  /api/categorias              — público
router.get('/', cacheMiddleware(600), index);

// POST /api/categorias              — solo admin (crear categoría)
router.post('/', authenticate, authorize('admin_sig'), csrfProtection, create);

// POST /api/categorias/:nombre/thumbnail — solo admin (subir imagen)
// csrfProtection ANTES de uploadSingle: rechaza la petición forjada antes de parsear el multipart.
router.post(
  '/:nombre/thumbnail',
  authenticate,
  authorize('admin_sig'),
  csrfProtection,
  uploadSingle('thumbnail', 'categorias/thumbnails', 5),
  upsertThumbnail,
);

// DELETE /api/categorias/:nombre    — solo admin
router.delete('/:nombre', authenticate, authorize('admin_sig'), csrfProtection, destroy);

export default router;
