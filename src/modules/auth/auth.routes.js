import { Router } from 'express';
import { login, visitante, register, me } from './auth.controller.js';
import { authenticate } from '../../middlewares/auth.js';
import { authRateLimiter } from '../../middlewares/rateLimiter.js';

const router = Router();

router.post('/login',     authRateLimiter, login);
router.post('/visitante', authRateLimiter, visitante); // acceso rápido sin credenciales
router.post('/registro',  authRateLimiter, register);
router.get('/me',         authenticate,   me);

export default router;
