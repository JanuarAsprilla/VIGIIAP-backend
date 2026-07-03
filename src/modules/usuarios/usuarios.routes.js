import { Router } from 'express';
import { index, getMe, updateRol, updateMe, changePassword } from './usuarios.controller.js';
import { authenticate, authorize } from '../../middlewares/auth.js';

const router = Router();

// Roles verificados: únicos con perfil funcional que gestionar.
const VERIFICADOS = ['investigador', 'tecnico', 'institucional', 'admin_sig', 'super_admin'];

router.get('/', authenticate, authorize('admin_sig'), index);
router.get('/me', authenticate, getMe);
router.patch('/:id/rol', authenticate, authorize('admin_sig'), updateRol);
router.patch('/me', authenticate, authorize(...VERIFICADOS), updateMe);
router.patch('/me/password', authenticate, authorize(...VERIFICADOS), changePassword);

export default router;
