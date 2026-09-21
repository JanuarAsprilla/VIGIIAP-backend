import { Router } from 'express';
import { index, create, update, reorder, destroy } from './herramientas.controller.js';
import { authenticate, authorize, optionalAuthenticate } from '../../middlewares/auth.js';
import { requireModulo } from '../../middlewares/requireModulo.js';
import { csrfProtection } from '../../middlewares/csrf.js';
import { cacheMiddleware } from '../../middlewares/cache.js';

const router = Router();

// GET /api/herramientas — público (solo activas; ?admin=true de un
// admin_sig/super_admin autenticado también ve las inactivas). cacheMiddleware
// ya omite el cache para cualquier request autenticado (ver categorias.routes.js).
router.get('/', cacheMiddleware(600), optionalAuthenticate, index);

// PATCH /api/herramientas/reordenar — antes de /:clave para que Express no
// intente resolver "reordenar" como una clave de herramienta.
router.patch('/reordenar', authenticate, authorize('admin_sig'), requireModulo('herramientas', 'editar'), csrfProtection, reorder);

router.post('/', authenticate, authorize('admin_sig'), requireModulo('herramientas', 'editar'), csrfProtection, create);
router.patch('/:clave', authenticate, authorize('admin_sig'), requireModulo('herramientas', 'editar'), csrfProtection, update);
router.delete('/:clave', authenticate, authorize('admin_sig'), requireModulo('herramientas', 'editar'), csrfProtection, destroy);

export default router;
