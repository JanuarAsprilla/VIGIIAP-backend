import { Router } from 'express';
import { index, show, store, update, destroy } from './documentos.controller.js';
import { authenticate, authorize, optionalAuthenticate } from '../../middlewares/auth.js';
import { uploadSingle } from '../../middlewares/upload.js';

const router = Router();

router.get('/',     optionalAuthenticate, index);
router.get('/:slug', optionalAuthenticate, show);
router.post(
  '/',
  authenticate,
  authorize('admin_sig', 'investigador'),
  uploadSingle('archivo', 'documentos'),
  store,
);
router.put(
  '/:id',
  authenticate,
  authorize('admin_sig'),
  uploadSingle('archivo', 'documentos'),
  update,
);
router.delete('/:id', authenticate, authorize('admin_sig'), destroy);

export default router;
