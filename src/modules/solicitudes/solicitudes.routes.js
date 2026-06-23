import { Router } from 'express';
import { index, mine, show, store, updateEstado, responder } from './solicitudes.controller.js';
import { authenticate, authorize } from '../../middlewares/auth.js';

const router = Router();

router.get('/', authenticate, authorize('admin_sig'), index);
router.get('/mis-solicitudes', authenticate, mine);
router.post('/', authenticate, authorize('publico', 'investigador', 'tecnico', 'institucional', 'admin_sig', 'super_admin'), store);
router.get('/:id', authenticate, show);
router.patch('/:id/estado', authenticate, authorize('admin_sig'), updateEstado);
router.post('/:id/responder', authenticate, authorize('admin_sig'), responder);

export default router;
