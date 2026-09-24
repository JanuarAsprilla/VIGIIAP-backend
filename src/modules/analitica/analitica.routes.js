import { Router } from 'express';
import {
  pageview, resumen, paginasTop, dispositivos, fuentesTrafico, entradaSalida,
} from './analitica.controller.js';
import { authenticate, authorize } from '../../middlewares/auth.js';
import { requireModulo } from '../../middlewares/requireModulo.js';

const router = Router();

// POST /api/analitica/pageview — beacon público y anónimo, sin authenticate:
// se ejecuta en cada navegación de cualquier visitante (con o sin sesión) y
// nunca lee ni guarda identidad. Rate limiting general (rateLimiter.js) ya
// aplica sobre toda /api/v1 antes de llegar aquí.
router.post('/pageview', pageview);

// Lecturas: gateadas por el módulo 'actividad' ya existente (esta analítica
// vive como pestaña dentro de la pantalla de Actividad del panel admin, no
// como un módulo delegable aparte).
router.get('/resumen',          authenticate, authorize('admin_sig'), requireModulo('actividad', 'ver'), resumen);
router.get('/paginas-top',      authenticate, authorize('admin_sig'), requireModulo('actividad', 'ver'), paginasTop);
router.get('/dispositivos',     authenticate, authorize('admin_sig'), requireModulo('actividad', 'ver'), dispositivos);
router.get('/fuentes-trafico',  authenticate, authorize('admin_sig'), requireModulo('actividad', 'ver'), fuentesTrafico);
router.get('/entrada-salida',   authenticate, authorize('admin_sig'), requireModulo('actividad', 'ver'), entradaSalida);

export default router;
