import { Router } from 'express';
import {
  login,
  visitante,
  register,
  verifyEmail,
  reenviarVerificacion,
  recuperarPassword,
  resetPassword,
  me,
} from './auth.controller.js';
import { authenticate } from '../../middlewares/auth.js';
import { authRateLimiter } from '../../middlewares/rateLimiter.js';

const router = Router();

router.post('/login',                  authRateLimiter, login);
router.post('/visitante',              authRateLimiter, visitante);
router.post('/registro',               authRateLimiter, register);
router.get('/verificar-email/:token',  verifyEmail);
router.post('/reenviar-verificacion',  authRateLimiter, reenviarVerificacion);
router.post('/recuperar-password',     authRateLimiter, recuperarPassword);
router.post('/reset-password',         authRateLimiter, resetPassword);
router.get('/me',                      authenticate, me);

export default router;
