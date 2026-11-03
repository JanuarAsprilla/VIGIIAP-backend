import { Router } from 'express';
import * as c from './actualizacion.controller.js';
import { authenticate, authorize, requireSuperAdmin } from '../../../middlewares/auth.js';
import { requireModulo } from '../../../middlewares/requireModulo.js';
import { csrfProtection } from '../../../middlewares/csrf.js';

const router = Router();
const MODULO = 'biodiversidad_datos';

// Ver el estado y la bitácora: super_admin, o admin_sig con el módulo en «ver».
router.get('/', authenticate, authorize('admin_sig'), requireModulo(MODULO, 'ver'), c.ver);
router.get('/ejecuciones', authenticate, authorize('admin_sig'), requireModulo(MODULO, 'ver'), c.ejecuciones);

// Ajustes (modo, frecuencia, quién aporta la cuenta de GBIF): solo el Super Administrador.
router.put('/ajustes', authenticate, requireSuperAdmin, csrfProtection, c.cambiarAjustes);

// Pedir una ejecución y gestionar la cuenta de GBIF propia: módulo en «editar». La de otra persona, solo super_admin (en el controlador).
router.post('/ejecuciones', authenticate, authorize('admin_sig'), requireModulo(MODULO, 'editar'), csrfProtection, c.solicitar);
router.put('/credencial', authenticate, authorize('admin_sig'), requireModulo(MODULO, 'editar'), csrfProtection, c.guardarCredencial);
router.delete('/credencial', authenticate, authorize('admin_sig'), requireModulo(MODULO, 'editar'), csrfProtection, c.borrarCredencial);

export default router;
