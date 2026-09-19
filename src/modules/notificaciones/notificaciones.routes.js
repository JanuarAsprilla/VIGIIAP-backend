import { Router } from 'express';
import { index, marcarLeida, marcarTodasLeidas } from './notificaciones.controller.js';
import * as tipos from './tiposNotificacion.controller.js';
import * as prefs from './prefs.controller.js';
import { authenticate, authorize } from '../../middlewares/auth.js';
import { csrfProtection } from '../../middlewares/csrf.js';

const router = Router();

// 'visitante' queda excluido a propósito: es una sesión anónima sin fila en
// `usuarios` (ver auth.service.js -- se guarda en la tabla `visitantes`
// aparte), y notificaciones.destinatario_id referencia usuarios(id) NOT
// NULL. El resto de roles sí tiene una cuenta real y puede recibir
// notificaciones, no solo los administradores.
const CON_CUENTA = ['publico', 'investigador', 'tecnico', 'institucional', 'admin_sig', 'super_admin'];

// Catálogo de tipos (Fase 2) -- lectura para cualquier cuenta (alimenta el
// panel de preferencias propio), escritura exclusiva de super_admin: es
// configuración estructural, no contenido del día a día (mismo criterio que
// la sección "avanzado" de Configuración). Registradas antes de `/:id/leida`
// para que ninguna clave de tipo pueda colisionar con ese patrón dinámico.
router.get('/tipos',           authenticate, authorize(...CON_CUENTA), tipos.index);
router.post('/tipos',          authenticate, authorize('super_admin'), csrfProtection, tipos.create);
router.patch('/tipos/:clave',  authenticate, authorize('super_admin'), csrfProtection, tipos.update);
router.delete('/tipos/:clave', authenticate, authorize('super_admin'), csrfProtection, tipos.destroy);

// Preferencias por usuario (Fase 3) -- autoservicio, cada quien gestiona las suyas.
router.get('/prefs',           authenticate, authorize(...CON_CUENTA), prefs.index);
router.patch('/prefs/:clave',  authenticate, authorize(...CON_CUENTA), csrfProtection, prefs.update);

router.get('/',                authenticate, authorize(...CON_CUENTA), index);
router.patch('/leer-todas',    authenticate, authorize(...CON_CUENTA), csrfProtection, marcarTodasLeidas);
router.patch('/:id/leida',     authenticate, authorize(...CON_CUENTA), csrfProtection, marcarLeida);

export default router;
