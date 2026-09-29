import { Router } from 'express';
import { actualizarMedio, eliminarMedio } from './fichas.controller.js';
import { authenticate, authorize } from '../../middlewares/auth.js';
import { requireModulo } from '../../middlewares/requireModulo.js';
import { csrfProtection } from '../../middlewares/csrf.js';

const router = Router();

// Rutas por id de medio directo (no anidadas bajo capa/ficha) -- mismo criterio
// que fichas-medios en el contrato de API: editar/borrar un medio puntual no
// necesita repetir configId/valor en la URL.
router.patch('/:medioId', authenticate, authorize('admin_sig'), requireModulo('geovisores', 'editar'), csrfProtection, actualizarMedio);
router.delete('/:medioId', authenticate, authorize('admin_sig'), requireModulo('geovisores', 'editar'), csrfProtection, eliminarMedio);

export default router;
