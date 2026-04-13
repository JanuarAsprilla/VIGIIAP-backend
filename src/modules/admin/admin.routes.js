import { Router } from 'express';
import { stats, listarUsuarios, crearUsuario, actualizarUsuario, auditLog } from './admin.controller.js';
import { authenticate, authorize } from '../../middlewares/auth.js';

const router = Router();

// Solo admin_sig puede acceder a todos los endpoints admin
router.use(authenticate, authorize('admin_sig'));

router.get('/stats',          stats);
router.get('/usuarios',       listarUsuarios);
router.post('/usuarios',      crearUsuario);
router.patch('/usuarios/:id', actualizarUsuario);
router.get('/audit',          auditLog);

export default router;
