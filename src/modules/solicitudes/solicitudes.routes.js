import { Router } from 'express';
import {
  index, mine, show, store, updateEstado, responder,
  listArchivos, uploadArchivo, deleteArchivo, downloadArchivo,
} from './solicitudes.controller.js';
import { authenticate, authorize } from '../../middlewares/auth.js';
import { uploadSingle } from '../../middlewares/upload.js';

const router = Router();

router.get('/', authenticate, authorize('admin_sig'), index);
router.get('/mis-solicitudes', authenticate, mine);
router.get('/:id', authenticate, show);
router.post('/', authenticate, authorize('publico', 'investigador', 'tecnico', 'institucional', 'admin_sig', 'super_admin'), store);
router.patch('/:id/estado', authenticate, authorize('admin_sig'), updateEstado);
router.post('/:id/responder', authenticate, authorize('admin_sig'), responder);

// Archivos adjuntos a solicitudes
router.get('/:id/archivos', authenticate, listArchivos);
router.post('/:id/archivos', authenticate, ...uploadSingle('archivo', 'solicitudes/archivos', 20, 'document'), uploadArchivo);
router.delete('/:id/archivos/:archivoId', authenticate, authorize('admin_sig'), deleteArchivo);
router.get('/:id/archivos/:archivoId/download', authenticate, downloadArchivo);

export default router;
