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
import { setup as tfSetup, verify as tfVerify, disable as tfDisable, confirm as tfConfirm } from './twoFactor.controller.js';

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

// 2FA TOTP
router.post('/2fa/setup',    authenticate, tfSetup);
router.post('/2fa/verify',   authenticate, tfVerify);
router.post('/2fa/disable',  authenticate, tfDisable);
router.post('/2fa/confirm',  tfConfirm); // usa cookie vigiiap_2fa_temp, sin authenticate

export default router;
