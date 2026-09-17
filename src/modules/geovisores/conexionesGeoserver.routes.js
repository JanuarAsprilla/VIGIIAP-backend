import { Router } from 'express';
import {
  index, show, store, update, destroy,
} from './conexionesGeoserver.controller.js';
import { authenticate, authorize, requireSuperAdmin } from '../../middlewares/auth.js';
import { requireModulo } from '../../middlewares/requireModulo.js';
import { csrfProtection } from '../../middlewares/csrf.js';

const router = Router();

// admin_sig puede LEER (para elegir a cuál apunta un geovisor nuevo) pero nunca escribir -- el
// service ya excluye password_cifrado de toda respuesta, aquí solo se restringe la escritura a
// super_admin, que es quien gestiona la infraestructura de conexiones.
router.get('/', authenticate, authorize('admin_sig'), requireModulo('conexiones_geoserver', 'ver'), index);
router.get('/:id', authenticate, authorize('admin_sig'), requireModulo('conexiones_geoserver', 'ver'), show);
router.post('/', authenticate, requireSuperAdmin, csrfProtection, store);
router.patch('/:id', authenticate, requireSuperAdmin, csrfProtection, update);
router.delete('/:id', authenticate, requireSuperAdmin, csrfProtection, destroy);

export default router;
