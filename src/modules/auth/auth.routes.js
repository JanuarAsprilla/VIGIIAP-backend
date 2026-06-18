import { Router } from 'express';
import {
  login,
  logout,
  visitante,
  register,
  verifyEmail,
  reenviarVerificacion,
  recuperarPassword,
  resetPassword,
  me,
  refresh,
} from './auth.controller.js';
import { authenticate } from '../../middlewares/auth.js';
import { authRateLimiter } from '../../middlewares/rateLimiter.js';
import { getSessions, revokeSession, revokeAllSessions } from './sessions.controller.js';

const router = Router();

router.post('/login',                  authRateLimiter, login);
router.post('/refresh',                authRateLimiter, refresh);
router.post('/logout',                 authenticate,    logout);
router.post('/visitante',              authRateLimiter, visitante);
router.post('/registro',               authRateLimiter, register);
router.get('/verificar-email/:token',  verifyEmail);
router.post('/reenviar-verificacion',  authRateLimiter, reenviarVerificacion);
router.post('/recuperar-password',     authRateLimiter, recuperarPassword);
router.post('/reset-password',         authRateLimiter, resetPassword);
router.get('/me',                      authenticate, me);

// Gestión de sesiones activas
router.get('/sessions',        authenticate, getSessions);
router.delete('/sessions/:id', authenticate, revokeSession);
router.delete('/sessions',     authenticate, revokeAllSessions);

export default router;
