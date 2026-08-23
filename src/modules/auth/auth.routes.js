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
  csrfToken,
} from './auth.controller.js';
import { authenticate } from '../../middlewares/auth.js';
import { csrfProtection } from '../../middlewares/csrf.js';
import { authRateLimiter, loginAccountRateLimiter, passwordResetLimiter } from '../../middlewares/rateLimiter.js';
import { getSessions, revokeSession, revokeAllSessions } from './sessions.controller.js';
import { setup as tfSetup, verify as tfVerify, disable as tfDisable, confirm as tfConfirm } from './twoFactor.controller.js';
import { changeExpiredPassword } from './expiredPassword.controller.js';

const router = Router();

// Login/registro/recuperación no tienen sesión previa (nada que forjar vía CSRF
// con la cookie httpOnly aún inexistente) — csrfProtection no aplica ahí.
// Además del límite por IP, /login aplica un segundo límite por cuenta objetivo
// (email) — mitiga fuerza bruta contra una cuenta específica vía IPs rotadas/spoofed.
router.post('/login',                  authRateLimiter, loginAccountRateLimiter, login);
router.post('/refresh',                authRateLimiter, refresh);
router.post('/logout',                 authenticate, csrfProtection, logout);
router.post('/visitante',              authRateLimiter, visitante);
router.post('/registro',               authRateLimiter, register);
router.get('/verificar-email/:token',  verifyEmail);
router.post('/reenviar-verificacion',  authRateLimiter, reenviarVerificacion);
router.post('/recuperar-password',     authRateLimiter, passwordResetLimiter, recuperarPassword);
router.post('/reset-password',         authRateLimiter, resetPassword);
router.get('/me',                      authenticate, me);
router.get('/csrf-token',              authenticate, csrfToken);

// Gestión de sesiones activas
router.get('/sessions',        authenticate, getSessions);
router.delete('/sessions/:id', authenticate, csrfProtection, revokeSession);
router.delete('/sessions',     authenticate, csrfProtection, revokeAllSessions);

// Cambio de contraseña expirada (usa cookie vigiiap_expired_temp)
router.post('/change-expired-password', authRateLimiter, changeExpiredPassword);

// 2FA TOTP
// authRateLimiter en todos los endpoints 2FA — previene fuerza bruta con token robado
router.post('/2fa/setup',    authenticate, authRateLimiter, csrfProtection, tfSetup);
router.post('/2fa/verify',   authenticate, authRateLimiter, csrfProtection, tfVerify);
router.post('/2fa/disable',  authenticate, authRateLimiter, csrfProtection, tfDisable);
router.post('/2fa/confirm',  authRateLimiter, tfConfirm); // usa cookie vigiiap_2fa_temp, sin authenticate

export default router;
