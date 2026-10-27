import { Router } from 'express';
import {
  index, seleccionables, show, store, update, destroy, workspaces, wmsPreview, leyendaPreview, atributosCapa,
} from './conexionesGeoserver.controller.js';
import { authenticate, authorize, requireSuperAdmin } from '../../middlewares/auth.js';
import { requireModulo } from '../../middlewares/requireModulo.js';
import { csrfProtection } from '../../middlewares/csrf.js';
import { tileRateLimiter } from '../../middlewares/rateLimiter.js';

const router = Router();

// El detalle de las conexiones (URL, usuario) se ve con el módulo 'conexiones_geoserver'; la
// escritura es solo de super_admin, que gestiona la infraestructura. El service nunca devuelve
// password_cifrado.
router.get('/', authenticate, authorize('admin_sig'), requireModulo('conexiones_geoserver', 'ver'), index);
// Constructor de geovisores: lista mínima (id, nombre, tipo, activo) para elegir a cuál conexión
// apuntar. Se gatea por 'geovisores', no por 'conexiones_geoserver': quien puede construir
// geovisores puede usar las conexiones sin ver ni administrar sus datos. Va antes de /:id.
router.get('/seleccionables', authenticate, authorize('admin_sig'), requireModulo('geovisores', 'ver'), seleccionables);
router.get('/:id', authenticate, authorize('admin_sig'), requireModulo('conexiones_geoserver', 'ver'), show);

// Constructor de geovisores: descubrir workspaces y previsualizar capas ANTES de guardar el
// geovisor (sin slug todavía no hay a qué atar los proxies de geovisores.routes.js). Se gatea por
// el módulo 'geovisores' (no 'conexiones_geoserver'): es la acción de construir un geovisor, no de
// administrar la conexión en sí.
router.get('/:id/workspaces', authenticate, authorize('admin_sig'), requireModulo('geovisores', 'editar'), workspaces);
router.get('/:id/wms', authenticate, authorize('admin_sig'), requireModulo('geovisores', 'editar'), tileRateLimiter, wmsPreview);
router.get('/:id/leyenda/:capaId', authenticate, authorize('admin_sig'), requireModulo('geovisores', 'editar'), tileRateLimiter, leyendaPreview);
router.get('/:id/capas/:capaId/atributos', authenticate, authorize('admin_sig'), requireModulo('geovisores', 'editar'), atributosCapa);

router.post('/', authenticate, requireSuperAdmin, csrfProtection, store);
router.patch('/:id', authenticate, requireSuperAdmin, csrfProtection, update);
router.delete('/:id', authenticate, requireSuperAdmin, csrfProtection, destroy);

export default router;
