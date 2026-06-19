import { Router } from 'express';
import { index, show, store, update, destroy } from './noticias.controller.js';
import { authenticate, authorize, optionalAuthenticate } from '../../middlewares/auth.js';
import { uploadSingle } from '../../middlewares/upload.js';
import { uploadRateLimiter } from '../../middlewares/rateLimiter.js';
import { cacheMiddleware } from '../../middlewares/cache.js';

const router = Router();

const noticiaUpload = uploadSingle('imagen', 'noticias/thumbnails', 5, 'image');

router.get('/',      cacheMiddleware(120), optionalAuthenticate, index);
router.get('/:slug', cacheMiddleware(300), optionalAuthenticate, show);
router.post('/', authenticate, authorize('admin_sig'), uploadRateLimiter, noticiaUpload, store);
router.put('/:id', authenticate, authorize('admin_sig'), uploadRateLimiter, noticiaUpload, update);
router.delete('/:id', authenticate, authorize('admin_sig'), destroy);

export default router;
