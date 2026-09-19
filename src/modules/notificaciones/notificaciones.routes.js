import { Router } from 'express';
import { index, marcarLeida, marcarTodasLeidas } from './notificaciones.controller.js';
import { authenticate, authorize } from '../../middlewares/auth.js';
import { csrfProtection } from '../../middlewares/csrf.js';

const router = Router();

// 'visitante' queda excluido a propósito: es una sesión anónima sin fila en
// `usuarios` (ver auth.service.js -- se guarda en la tabla `visitantes`
// aparte), y notificaciones.destinatario_id referencia usuarios(id) NOT
// NULL. El resto de roles sí tiene una cuenta real y puede recibir
// notificaciones, no solo los administradores.
const CON_CUENTA = ['publico', 'investigador', 'tecnico', 'institucional', 'admin_sig', 'super_admin'];

router.get('/',                authenticate, authorize(...CON_CUENTA), index);
router.patch('/leer-todas',    authenticate, authorize(...CON_CUENTA), csrfProtection, marcarTodasLeidas);
router.patch('/:id/leida',     authenticate, authorize(...CON_CUENTA), csrfProtection, marcarLeida);

export default router;
