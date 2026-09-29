import { Router } from 'express';
import {
  obtenerConfig, upsertConfig, obtenerFicha, upsertFicha, eliminarFicha, features,
} from './fichas.controller.js';
import { authenticate, authorize } from '../../middlewares/auth.js';
import { requireModulo } from '../../middlewares/requireModulo.js';
import { csrfProtection } from '../../middlewares/csrf.js';

const router = Router();

// Gateado por el módulo 'geovisores' (no uno propio de "fichas") -- es una
// extensión de la curaduría de un geovisor, mismo criterio que
// conexionesGeoserver.routes.js#workspaces.
router.get('/', authenticate, authorize('admin_sig'), requireModulo('geovisores', 'editar'), obtenerConfig);
router.put('/', authenticate, authorize('admin_sig'), requireModulo('geovisores', 'editar'), csrfProtection, upsertConfig);
router.get('/:configId/features', authenticate, authorize('admin_sig'), requireModulo('geovisores', 'editar'), features);
router.get('/:configId/fichas/:valor', authenticate, authorize('admin_sig'), requireModulo('geovisores', 'editar'), obtenerFicha);
router.put('/:configId/fichas/:valor', authenticate, authorize('admin_sig'), requireModulo('geovisores', 'editar'), csrfProtection, upsertFicha);
router.delete('/:configId/fichas/:valor', authenticate, authorize('admin_sig'), requireModulo('geovisores', 'editar'), csrfProtection, eliminarFicha);

export default router;
