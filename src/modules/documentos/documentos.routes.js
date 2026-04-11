import { Router } from 'express';
import { index, show, store, destroy } from './documentos.controller.js';
import { authenticate, authorize } from '../../middlewares/auth.js';

const router = Router();

router.get('/', index);
router.get('/:slug', show);
router.post('/', authenticate, authorize('admin_sig', 'investigador'), store);
router.delete('/:id', authenticate, authorize('admin_sig'), destroy);

export default router;
