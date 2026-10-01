import { Router } from 'express';
import {
  obtenerConfig, upsertConfig, obtenerFicha, upsertFicha, importarFichas, eliminarFicha, features,
  subirMedio, reordenarMedios,
} from './fichas.controller.js';
import { authenticate, authorize } from '../../middlewares/auth.js';
import { requireModulo } from '../../middlewares/requireModulo.js';
import { csrfProtection } from '../../middlewares/csrf.js';
import { uploadMedioFicha } from './fichasMedios.middleware.js';
import { uploadRateLimiter } from '../../middlewares/rateLimiter.js';

const router = Router();

// Gateado por el módulo 'geovisores' (no uno propio de "fichas") -- es una
// extensión de la curaduría de un geovisor, mismo criterio que
// conexionesGeoserver.routes.js#workspaces.
router.get('/', authenticate, authorize('admin_sig'), requireModulo('geovisores', 'editar'), obtenerConfig);
router.put('/', authenticate, authorize('admin_sig'), requireModulo('geovisores', 'editar'), csrfProtection, upsertConfig);
router.get('/:configId/features', authenticate, authorize('admin_sig'), requireModulo('geovisores', 'editar'), features);
router.post('/:configId/fichas/importar', authenticate, authorize('admin_sig'), requireModulo('geovisores', 'editar'), csrfProtection, importarFichas);
router.get('/:configId/fichas/:valor', authenticate, authorize('admin_sig'), requireModulo('geovisores', 'editar'), obtenerFicha);
router.put('/:configId/fichas/:valor', authenticate, authorize('admin_sig'), requireModulo('geovisores', 'editar'), csrfProtection, upsertFicha);
router.delete('/:configId/fichas/:valor', authenticate, authorize('admin_sig'), requireModulo('geovisores', 'editar'), csrfProtection, eliminarFicha);
// csrfProtection ANTES de uploadMedioFicha -- mismo criterio que geovisores.routes.js#thumbnail:
// rechaza la petición forjada antes de parsear el multipart (y antes de escribir nada a disco).
router.post('/:configId/fichas/:valor/medios', authenticate, authorize('admin_sig'), requireModulo('geovisores', 'editar'), csrfProtection, uploadRateLimiter, uploadMedioFicha, subirMedio);
router.put('/:configId/fichas/:valor/medios/orden', authenticate, authorize('admin_sig'), requireModulo('geovisores', 'editar'), csrfProtection, reordenarMedios);

export default router;
