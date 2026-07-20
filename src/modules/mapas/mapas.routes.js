import { Router } from 'express';
import { index, show, store, update, patchActivo, destroy } from './mapas.controller.js';
import { authenticate, authorize, optionalAuthenticate } from '../../middlewares/auth.js';
import { uploadFields } from '../../middlewares/upload.js';
import { geoValidatorMiddleware } from '../../middlewares/geoValidator.js';
import { uploadRateLimiter } from '../../middlewares/rateLimiter.js';
import { cacheMiddleware } from '../../middlewares/cache.js';

const router = Router();

const mapaUpload = uploadFields([
  { name: 'archivo_pdf', folder: 'mapas/pdf',        maxSizeMB: 50, category: 'document'  },
  { name: 'archivo_img', folder: 'mapas/img',        maxSizeMB: 10, category: 'image'     },
  { name: 'thumbnail',   folder: 'mapas/thumbnails', maxSizeMB: 5,  category: 'thumbnail' },
]);

router.get('/', cacheMiddleware(120), optionalAuthenticate, index);
router.get('/:slug', cacheMiddleware(300), optionalAuthenticate, show);
router.post('/', authenticate, authorize('admin_sig'), uploadRateLimiter, geoValidatorMiddleware, mapaUpload, store);
router.patch('/:id', authenticate, authorize('admin_sig'), uploadRateLimiter, geoValidatorMiddleware, mapaUpload, update);
router.patch('/:id/activo', authenticate, authorize('admin_sig'), patchActivo);
router.delete('/:id', authenticate, authorize('admin_sig'), destroy);

export default router;
