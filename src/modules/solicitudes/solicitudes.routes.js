import { Router } from 'express';
import { index, mine, store, updateEstado } from './solicitudes.controller.js';
import { authenticate, authorize } from '../../middlewares/auth.js';

const router = Router();

router.get('/', authenticate, authorize('admin_sig'), index);
router.get('/mis-solicitudes', authenticate, mine);
router.post('/', authenticate, store);
router.patch('/:id/estado', authenticate, authorize('admin_sig'), updateEstado);

export default router;
