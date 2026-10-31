import { Router } from 'express';
import {
  pageview, evento, resumen, paginasTop, dispositivos, fuentesTrafico, entradaSalida, ubicaciones, sesionesRecientes,
  eventosTop, tiempoReal,
} from './analitica.controller.js';
import { authenticate, authorize } from '../../middlewares/auth.js';
import { requireModulo } from '../../middlewares/requireModulo.js';

const router = Router();

// POST /api/analitica/pageview — beacon público, sin authenticate: se ejecuta en cada
// navegación de cualquier visitante (con o sin sesión). Guarda la IP y la ubicación
// aproximada de la sesión (con purga automática) pero nunca la identidad del usuario. Rate limiting general (rateLimiter.js) ya
// aplica sobre toda /api/v1 antes de llegar aquí.
router.post('/pageview', pageview);

// POST /api/analitica/evento — acción concreta del visitante (descargar, abrir un geovisor…).
// Mismo criterio que pageview: público, anónimo, catálogo cerrado de nombres.
router.post('/evento', evento);

// Lecturas: gateadas por el módulo 'actividad' ya existente (esta analítica
// vive como pestaña dentro de la pantalla de Actividad del panel admin, no
// como un módulo delegable aparte).
router.get('/resumen',          authenticate, authorize('admin_sig'), requireModulo('actividad', 'ver'), resumen);
router.get('/paginas-top',      authenticate, authorize('admin_sig'), requireModulo('actividad', 'ver'), paginasTop);
router.get('/dispositivos',     authenticate, authorize('admin_sig'), requireModulo('actividad', 'ver'), dispositivos);
router.get('/fuentes-trafico',  authenticate, authorize('admin_sig'), requireModulo('actividad', 'ver'), fuentesTrafico);
router.get('/entrada-salida',   authenticate, authorize('admin_sig'), requireModulo('actividad', 'ver'), entradaSalida);
router.get('/ubicaciones',      authenticate, authorize('admin_sig'), requireModulo('actividad', 'ver'), ubicaciones);
router.get('/eventos-top',      authenticate, authorize('admin_sig'), requireModulo('actividad', 'ver'), eventosTop);
router.get('/tiempo-real',      authenticate, authorize('admin_sig'), requireModulo('actividad', 'ver'), tiempoReal);
router.get('/sesiones-recientes', authenticate, authorize('admin_sig'), requireModulo('actividad', 'ver'), sesionesRecientes);

export default router;
