import { Router } from 'express';
import { index, show, store, update, destroy } from './noticias.controller.js';
import { authenticate, authorize, optionalAuthenticate } from '../../middlewares/auth.js';
import { uploadSingle } from '../../middlewares/upload.js';

const router = Router();

const noticiaUpload = uploadSingle('imagen', 'noticias/thumbnails', 5);

router.get('/',      optionalAuthenticate, index);
router.get('/:slug', optionalAuthenticate, show);
router.post('/', authenticate, authorize('admin_sig'), noticiaUpload, store);
router.put('/:id', authenticate, authorize('admin_sig'), noticiaUpload, update);
router.delete('/:id', authenticate, authorize('admin_sig'), destroy);

export default router;
