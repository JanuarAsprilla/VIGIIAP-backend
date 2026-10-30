import { Router } from 'express';
import { optionalAuthenticate } from '../../middlewares/auth.js';
import { cacheMiddleware } from '../../middlewares/cache.js';
import { biodiversidadRateLimiter } from '../../middlewares/rateLimiter.js';
import { herramientaDisponible } from '../herramientas/herramientas.service.js';
import * as controller from './biodiversidad.controller.js';

const CLAVE_HERRAMIENTA = 'biodiversidad';

/**
 * Interruptor único: la fila `biodiversidad` del catálogo de Herramientas. Apagada responde 404
 * (no 403: no revela que existe) salvo a admin_sig/super_admin, que la prueban antes de encenderla.
 * Va ANTES del cache: un recurso apagado nunca se sirve desde cache. Si no se puede consultar el
 * interruptor, falla cerrado (error), nunca abierto.
 */
async function requiereHerramienta(req, res, next) {
  try {
    if (await herramientaDisponible(CLAVE_HERRAMIENTA, req.user)) return next();
    res.status(404).json({ error: 'Recurso no encontrado' });
  } catch (err) { next(err); }
}

const router = Router();

router.use(biodiversidadRateLimiter, optionalAuthenticate, requiereHerramienta);

// Solo /estado usa cache: no tiene parámetros. La clave de cacheMiddleware sólo distingue una lista
// blanca de parámetros (page, limit, q…) que no incluye grupo, departamento ni pagina; cachear
// /municipios o /registros serviría datos de un filtro para otro. Ver tests/biodiversidad.cache.test.js.
router.get('/estado', cacheMiddleware(300), controller.estado);
router.get('/municipios', controller.municipios);
router.get('/registros', controller.registros);

export default router;
