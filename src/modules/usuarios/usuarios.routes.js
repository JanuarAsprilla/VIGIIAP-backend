import { Router } from 'express';
import { index, getMe, updateRol, updateMe, updateAvatar, changePassword } from './usuarios.controller.js';
import { authenticate, authorize } from '../../middlewares/auth.js';
import { csrfProtection } from '../../middlewares/csrf.js';
import { uploadSingle } from '../../middlewares/upload.js';
import { uploadRateLimiter } from '../../middlewares/rateLimiter.js';

const router = Router();

// Roles verificados: únicos con perfil funcional que gestionar.
const VERIFICADOS = ['investigador', 'tecnico', 'institucional', 'admin_sig', 'super_admin'];

const avatarUpload = uploadSingle('avatar', 'avatars', 5, 'image');

router.get('/', authenticate, authorize('admin_sig'), index);
router.get('/me', authenticate, getMe);
router.patch('/:id/rol', authenticate, authorize('admin_sig'), csrfProtection, updateRol);
router.patch('/me', authenticate, authorize(...VERIFICADOS), csrfProtection, updateMe);
// csrfProtection ANTES de avatarUpload: rechaza la petición forjada antes de parsear el multipart.
router.patch('/me/avatar', authenticate, authorize(...VERIFICADOS), csrfProtection, uploadRateLimiter, avatarUpload, updateAvatar);
router.patch('/me/password', authenticate, authorize(...VERIFICADOS), csrfProtection, changePassword);

export default router;
