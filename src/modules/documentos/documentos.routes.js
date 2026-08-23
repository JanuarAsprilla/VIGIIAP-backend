import { Router } from 'express';
import { index, show, store, update, destroy, patchActivo } from './documentos.controller.js';
import { authenticate, authorize, optionalAuthenticate } from '../../middlewares/auth.js';
import { csrfProtection } from '../../middlewares/csrf.js';
import { uploadSingle } from '../../middlewares/upload.js';
import { uploadRateLimiter } from '../../middlewares/rateLimiter.js';
import { cacheMiddleware } from '../../middlewares/cache.js';

const router = Router();

router.get('/',      cacheMiddleware(120), optionalAuthenticate, index);
router.get('/:slug', cacheMiddleware(300), optionalAuthenticate, show);
// csrfProtection ANTES de uploadSingle: rechaza la petición forjada antes de parsear el multipart.
router.post(
  '/',
  authenticate,
  authorize('admin_sig'),
  csrfProtection,
  uploadRateLimiter,
  uploadSingle('archivo', 'documentos', 20, 'document'),
  store,
);
router.put(
  '/:id',
  authenticate,
  authorize('admin_sig'),
  csrfProtection,
  uploadRateLimiter,
  uploadSingle('archivo', 'documentos', 20, 'document'),
  update,
);
router.patch('/:id/activo', authenticate, authorize('admin_sig'), csrfProtection, patchActivo);
router.delete('/:id', authenticate, authorize('admin_sig'), csrfProtection, destroy);

export default router;
