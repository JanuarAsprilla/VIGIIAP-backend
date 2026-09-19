import { Router } from 'express';
import { index, create, rename, upsertThumbnail, destroy } from './categorias.controller.js';
import { authenticate, authorize, optionalAuthenticate } from '../../middlewares/auth.js';
import { requireModulo } from '../../middlewares/requireModulo.js';
import { csrfProtection } from '../../middlewares/csrf.js';
import { uploadSingle } from '../../middlewares/upload.js';
import { cacheMiddleware } from '../../middlewares/cache.js';

const router = Router();

// GET  /api/categorias              — público (el conteo por módulo respeta
// visibilidad/activo salvo ?admin=true de un admin_sig/super_admin autenticado
// -- ver getAll() en categorias.service.js. cacheMiddleware ya omite el cache
// para cualquier request autenticado, así que el panel admin nunca sirve una
// respuesta cacheada pensada para un visitante anónimo, ni al revés.)
router.get('/', cacheMiddleware(600), optionalAuthenticate, index);

// POST /api/categorias              — solo admin (crear categoría)
router.post('/', authenticate, authorize('admin_sig'), requireModulo('categorias', 'editar'), csrfProtection, create);

// POST /api/categorias/:nombre/thumbnail — solo admin (subir imagen)
// csrfProtection ANTES de uploadSingle: rechaza la petición forjada antes de parsear el multipart.
router.post(
  '/:nombre/thumbnail',
  authenticate,
  authorize('admin_sig'),
  requireModulo('categorias', 'editar'),
  csrfProtection,
  uploadSingle('thumbnail', 'categorias/thumbnails', 5),
  upsertThumbnail,
);

// PATCH /api/categorias/:nombre     — solo admin (renombrar)
router.patch('/:nombre', authenticate, authorize('admin_sig'), requireModulo('categorias', 'editar'), csrfProtection, rename);

// DELETE /api/categorias/:nombre    — solo admin
router.delete('/:nombre', authenticate, authorize('admin_sig'), requireModulo('categorias', 'editar'), csrfProtection, destroy);

export default router;
