import { Router } from 'express';
import multer from 'multer';
import { index, mine, show, store, updateEstado, responder,
         uploadArchivo, getArchivos, downloadArchivo, deleteArchivo } from './solicitudes.controller.js';
import { authenticate, authorize } from '../../middlewares/auth.js';
import { csrfProtection } from '../../middlewares/csrf.js';
import { uploadRateLimiter, adminRateLimiter } from '../../middlewares/rateLimiter.js';

const router = Router();

// Multer en memoria para archivos adjuntos de solicitudes (max 10 MB)
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

// Roles verificados: únicos que pueden consumir/crear solicitudes.
// 'publico' y 'visitante' (no verificados) quedan excluidos por completo.
const VERIFICADOS = ['investigador', 'tecnico', 'institucional', 'admin_sig', 'super_admin'];

router.get('/', authenticate, authorize('admin_sig'), adminRateLimiter, index);
router.get('/mis-solicitudes', authenticate, authorize(...VERIFICADOS), mine);
// 'publico' puede llegar al controlador — el permiso real se evalúa en tiempo de
// ejecución contra configuracion.publicoCanSolicitar (ver solicitudes.service.js#create).
// 'visitante' (sesión anónima, sin fila en `usuarios`) sigue excluido: solicitudes.usuario_id
// referencia usuarios.id, así que un visitante no puede ser dueño de una solicitud.
router.post('/', authenticate, authorize(...VERIFICADOS, 'publico'), csrfProtection, store);
router.get('/:id', authenticate, authorize(...VERIFICADOS), show);
router.patch('/:id/estado', authenticate, authorize('admin_sig'), csrfProtection, adminRateLimiter, updateEstado);
router.post('/:id/responder', authenticate, authorize('admin_sig'), csrfProtection, adminRateLimiter, responder);

// Archivos adjuntos de solicitudes — solo roles verificados (ownership validado en el servicio)
// csrfProtection ANTES de multer: rechaza la petición forjada antes de parsear el multipart.
router.post('/:id/archivos', authenticate, authorize(...VERIFICADOS), csrfProtection, uploadRateLimiter, upload.single('archivo'), uploadArchivo);
router.get('/:id/archivos', authenticate, authorize(...VERIFICADOS), getArchivos);
router.get('/:id/archivos/:archivoId/download', authenticate, authorize(...VERIFICADOS), downloadArchivo);
router.delete('/:id/archivos/:archivoId', authenticate, authorize('admin_sig', 'super_admin'), csrfProtection, deleteArchivo);

export default router;
