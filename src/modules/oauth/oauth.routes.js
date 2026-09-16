import { Router } from 'express';
import { listProviders, redirectToProvider, callback } from './oauth.controller.js';
import { authRateLimiter } from '../../middlewares/rateLimiter.js';

const router = Router();

// Montado en /api/v1/auth/oauth (ver auth.routes.js) — sin csrfProtection,
// igual que /login: no hay cookie de sesión previa que forjar en ninguno de
// los dos pasos (ida al proveedor, vuelta con el code).
router.get('/providers',          listProviders);
router.get('/:provider/start',    authRateLimiter, redirectToProvider);
router.get('/:provider/callback', authRateLimiter, callback);

export default router;
