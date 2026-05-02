import { Router } from 'express';
import { descargarMapa, descargarDocumento } from './descargas.controller.js';
import { optionalAuthenticate } from '../../middlewares/auth.js';
import { downloadRateLimiter } from '../../middlewares/rateLimiter.js';

const router = Router();

// Descarga protegida: verifica visibilidad, genera URL prefirmada (120s) y registra la descarga.
router.get('/mapa/:id',      downloadRateLimiter, optionalAuthenticate, descargarMapa);
router.get('/documento/:id', downloadRateLimiter, optionalAuthenticate, descargarDocumento);

export default router;
