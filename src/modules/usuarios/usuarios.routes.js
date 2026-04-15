import { Router } from 'express';
import { index, getMe, updateRol, updateMe, changePassword } from './usuarios.controller.js';
import { authenticate, authorize } from '../../middlewares/auth.js';

const router = Router();

router.get('/', authenticate, authorize('admin_sig'), index);
router.get('/me', authenticate, getMe);
router.patch('/:id/rol', authenticate, authorize('admin_sig'), updateRol);
router.patch('/me', authenticate, updateMe);
router.patch('/me/password', authenticate, changePassword);

export default router;
