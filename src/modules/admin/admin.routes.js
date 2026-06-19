import { Router } from 'express';
import { getPapelera, restaurar } from './papelera.controller.js';
import { exportUsuarios, exportSolicitudes, exportAudit, exportDescargas } from './export.controller.js';
import {
  stats, listarUsuarios, crearUsuario, actualizarUsuario, eliminarUsuario, auditLog,
  getConfiguracion, setConfiguracion, notificaciones,
  superStats, crearAdmin,
  custodiaRecurso, descargasRecurso, descargasStats, scanLog,
  batchUsuarios,
} from './admin.controller.js';
import { authenticate, authorize, requireSuperAdmin } from '../../middlewares/auth.js';

const router = Router();

// admin_sig Y super_admin acceden a todo (authorize ya lo incluye automáticamente)
router.use(authenticate, authorize('admin_sig'));

router.get('/stats',            stats);
router.get('/notificaciones',   notificaciones);
router.get('/usuarios',         listarUsuarios);
router.post('/usuarios',        crearUsuario);
router.patch('/usuarios/batch',  batchUsuarios);      // ANTES de /:id para no conflictar
router.patch('/usuarios/:id',   actualizarUsuario);
router.delete('/usuarios/:id',  eliminarUsuario);
router.get('/audit',            auditLog);
router.get('/configuracion',    getConfiguracion);
router.put('/configuracion',    setConfiguracion);

// ── Cadena de custodia y seguridad ───────────────────────────────────────────
router.get('/custodia',         custodiaRecurso);   // ?tipo=mapa&id=UUID
router.get('/descargas',        descargasRecurso);  // ?tipo=mapa&id=UUID
router.get('/descargas/stats',  descargasStats);
router.get('/scan-log',         scanLog);

// ── Rutas exclusivas de super_admin ──────────────────────────────────────────
router.get('/super/stats',         requireSuperAdmin, superStats);
router.post('/super/crear-admin',  requireSuperAdmin, crearAdmin);

// ── Exports CSV/JSON (admin_sig y super_admin) ────────────────────────────────
router.get('/export/usuarios',    exportUsuarios);
router.get('/export/solicitudes', exportSolicitudes);
router.get('/export/audit',       exportAudit);
router.get('/export/descargas',   exportDescargas);

// ── Papelera (soft deletes) — solo super_admin ────────────────────────────────
router.get('/papelera',                      requireSuperAdmin, getPapelera);
router.patch('/papelera/:tipo/:id/restaurar', requireSuperAdmin, restaurar);

export default router;
