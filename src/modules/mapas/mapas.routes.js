import { Router } from 'express';
import { index, show, store, update, destroy } from './mapas.controller.js';
import { authenticate, authorize } from '../../middlewares/auth.js';

const router = Router();

router.get('/', index);
router.get('/:slug', show);
router.post('/', authenticate, authorize('admin_sig'), store);
router.put('/:id', authenticate, authorize('admin_sig'), update);
router.delete('/:id', authenticate, authorize('admin_sig'), destroy);

export default router;
