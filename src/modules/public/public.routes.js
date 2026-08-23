import { Router } from 'express';
import { getConfiguracionPublica } from './public.controller.js';
import { cacheMiddleware } from '../../middlewares/cache.js';

const router = Router();

// Sin authenticate/authorize a propósito: este módulo es exclusivamente
// para datos públicos y de solo lectura. La restricción de qué se expone
// vive a nivel de query en public.service.js (whitelist), no aquí.
router.get('/configuracion', cacheMiddleware(300), getConfiguracionPublica);

export default router;
