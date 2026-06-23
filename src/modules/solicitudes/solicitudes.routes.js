import { Router } from 'express';
import multer from 'multer';
import { index, mine, show, store, updateEstado, responder,
         uploadArchivo, getArchivos, downloadArchivo, deleteArchivo } from './solicitudes.controller.js';
import { authenticate, authorize } from '../../middlewares/auth.js';
import { uploadRateLimiter } from '../../middlewares/rateLimiter.js';

const router = Router();

// Multer en memoria para archivos adjuntos de solicitudes (max 10 MB)
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

router.get('/', authenticate, authorize('admin_sig'), index);
router.get('/mis-solicitudes', authenticate, mine);
router.post('/', authenticate, authorize('publico', 'investigador', 'tecnico', 'institucional', 'admin_sig', 'super_admin'), store);
router.get('/:id', authenticate, show);
router.patch('/:id/estado', authenticate, authorize('admin_sig'), updateEstado);
router.post('/:id/responder', authenticate, authorize('admin_sig'), responder);

// Archivos adjuntos de solicitudes
router.post('/:id/archivos', authenticate, uploadRateLimiter, upload.single('archivo'), uploadArchivo);
router.get('/:id/archivos', authenticate, getArchivos);
router.get('/:id/archivos/:archivoId/download', authenticate, downloadArchivo);
router.delete('/:id/archivos/:archivoId', authenticate, authorize('admin_sig', 'super_admin'), deleteArchivo);

export default router;
