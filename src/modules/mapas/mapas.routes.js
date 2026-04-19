import { Router } from 'express';
import { index, show, store, update, patchActivo, destroy } from './mapas.controller.js';
import { authenticate, authorize, optionalAuthenticate } from '../../middlewares/auth.js';
import { uploadFields } from '../../middlewares/upload.js';

const router = Router();

const mapaUpload = uploadFields([
  { name: 'archivo_pdf', folder: 'mapas/pdf', maxSizeMB: 50 },
  { name: 'archivo_img', folder: 'mapas/img', maxSizeMB: 10 },
  { name: 'thumbnail',   folder: 'mapas/thumbnails', maxSizeMB: 5 },
]);

router.get('/', optionalAuthenticate, index);
router.get('/:slug', optionalAuthenticate, show);
router.post('/', authenticate, authorize('admin_sig'), mapaUpload, store);
router.put('/:id', authenticate, authorize('admin_sig'), mapaUpload, update);
router.patch('/:id/activo', authenticate, authorize('admin_sig'), patchActivo);
router.delete('/:id', authenticate, authorize('admin_sig'), destroy);

export default router;
