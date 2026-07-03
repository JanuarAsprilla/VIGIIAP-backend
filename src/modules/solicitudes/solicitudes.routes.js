import { Router } from 'express';
import multer from 'multer';
import { index, mine, show, store, updateEstado, responder,
         uploadArchivo, getArchivos, downloadArchivo, deleteArchivo } from './solicitudes.controller.js';
import { authenticate, authorize } from '../../middlewares/auth.js';
import { uploadRateLimiter } from '../../middlewares/rateLimiter.js';

const router = Router();

// Multer en memoria para archivos adjuntos de solicitudes (max 10 MB)
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

// Roles verificados: únicos que pueden consumir/crear solicitudes.
// 'publico' y 'visitante' (no verificados) quedan excluidos por completo.
const VERIFICADOS = ['investigador', 'tecnico', 'institucional', 'admin_sig', 'super_admin'];

router.get('/', authenticate, authorize('admin_sig'), index);
router.get('/mis-solicitudes', authenticate, authorize(...VERIFICADOS), mine);
router.post('/', authenticate, authorize(...VERIFICADOS), store);
router.get('/:id', authenticate, authorize(...VERIFICADOS), show);
router.patch('/:id/estado', authenticate, authorize('admin_sig'), updateEstado);
router.post('/:id/responder', authenticate, authorize('admin_sig'), responder);

// Archivos adjuntos de solicitudes — solo roles verificados (ownership validado en el servicio)
router.post('/:id/archivos', authenticate, authorize(...VERIFICADOS), uploadRateLimiter, upload.single('archivo'), uploadArchivo);
router.get('/:id/archivos', authenticate, authorize(...VERIFICADOS), getArchivos);
router.get('/:id/archivos/:archivoId/download', authenticate, authorize(...VERIFICADOS), downloadArchivo);
router.delete('/:id/archivos/:archivoId', authenticate, authorize('admin_sig', 'super_admin'), deleteArchivo);

export default router;
