import { Router } from 'express';
import {
  stats, listarUsuarios, crearUsuario, actualizarUsuario, eliminarUsuario, auditLog,
  getConfiguracion, setConfiguracion, notificaciones,
} from './admin.controller.js';
import { authenticate, authorize } from '../../middlewares/auth.js';

const router = Router();

// Solo admin_sig puede acceder a todos los endpoints admin
router.use(authenticate, authorize('admin_sig'));

router.get('/stats',            stats);
router.get('/notificaciones',   notificaciones);
router.get('/usuarios',         listarUsuarios);
router.post('/usuarios',        crearUsuario);
router.patch('/usuarios/:id',   actualizarUsuario);
router.delete('/usuarios/:id',  eliminarUsuario);
router.get('/audit',            auditLog);
router.get('/configuracion',    getConfiguracion);
router.put('/configuracion',    setConfiguracion);

export default router;
