import { Router } from 'express';
import { index, show, store, update, destroy } from './documentos.controller.js';
import { authenticate, authorize, optionalAuthenticate } from '../../middlewares/auth.js';
import { uploadSingle } from '../../middlewares/upload.js';
import { uploadRateLimiter } from '../../middlewares/rateLimiter.js';

const router = Router();

router.get('/',      optionalAuthenticate, index);
router.get('/:slug', optionalAuthenticate, show);
router.post(
  '/',
  authenticate,
  authorize('admin_sig', 'investigador'),
  uploadRateLimiter,
  uploadSingle('archivo', 'documentos', 20, 'document'),
  store,
);
router.put(
  '/:id',
  authenticate,
  authorize('admin_sig'),
  uploadRateLimiter,
  uploadSingle('archivo', 'documentos', 20, 'document'),
  update,
);
router.delete('/:id', authenticate, authorize('admin_sig'), destroy);

export default router;
