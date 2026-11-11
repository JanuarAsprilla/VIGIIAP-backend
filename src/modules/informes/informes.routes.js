import { Router } from 'express';
import {
  configuracionPublica, panel, actualizarGeneral, subirLogo, quitarLogo, actualizarHerramienta,
} from './informes.controller.js';
import { authenticate, authorize, optionalAuthenticate } from '../../middlewares/auth.js';
import { requireModulo } from '../../middlewares/requireModulo.js';
import { csrfProtection } from '../../middlewares/csrf.js';
import { uploadFields } from '../../middlewares/upload.js';
import { uploadRateLimiter, exportacionInformesRateLimiter } from '../../middlewares/rateLimiter.js';
import { registrosBiodiversidad } from './exportacion.controller.js';

const router = Router();

const logoUpload = uploadFields([{ name: 'logo', folder: 'informes', maxSizeMB: 2, category: 'image' }]);

// Lo consulta el botón «Descargar informe» de cada herramienta. Depende de quién pregunta: nunca se cachea.
router.get('/configuracion/:herramienta', optionalAuthenticate, configuracionPublica);

// Registros individuales de Biodiversidad para el Excel y el CSV: una sola petición con el tope de la configuración, en vez de
// cientos de páginas. Los permisos los decide el servidor (exportacion.controller.js), no el botón.
router.get('/biodiversidad/registros', optionalAuthenticate, exportacionInformesRateLimiter, registrosBiodiversidad);

const admin = [authenticate, authorize('admin_sig')];
router.get('/admin', ...admin, requireModulo('informes', 'ver'), panel);
router.put('/admin/general', ...admin, requireModulo('informes', 'editar'), csrfProtection, actualizarGeneral);
// csrfProtection ANTES de logoUpload: rechaza la petición forjada antes de parsear el multipart.
router.post('/admin/logo', ...admin, requireModulo('informes', 'editar'), csrfProtection, uploadRateLimiter, logoUpload, subirLogo);
router.delete('/admin/logo', ...admin, requireModulo('informes', 'editar'), csrfProtection, quitarLogo);
router.put('/admin/herramientas/:clave', ...admin, requireModulo('informes', 'editar'), csrfProtection, actualizarHerramienta);

export default router;
