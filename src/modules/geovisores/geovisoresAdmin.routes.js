import { Router } from 'express';
import { completitud } from './geovisores.controller.js';
import { authenticate, authorize } from '../../middlewares/auth.js';
import { requireModulo } from '../../middlewares/requireModulo.js';

const router = Router();

// Montado en /admin/geovisores -- separado de geovisores.routes.js (montado en
// /geovisores sin prefijo /admin) porque el frontend (VIGIIAP,
// useCompletitudGeovisor en src/hooks/useGeovisores.ts) llama exactamente a
// esta ruta con el prefijo /admin/geovisores, a diferencia del resto del CRUD
// de geovisores. Descubierto en la prueba end-to-end real: la ruta anterior
// (/geovisores/:id/completitud) nunca la alcanzaba el frontend -- 404 mudo.
router.get('/:id/completitud', authenticate, authorize('admin_sig'), requireModulo('geovisores', 'editar'), completitud);

export default router;
