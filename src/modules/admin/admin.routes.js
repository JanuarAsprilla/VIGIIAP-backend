import { Router } from 'express';
import { getPapelera, restaurar, purgar } from './papelera.controller.js';
import { exportUsuarios, exportSolicitudes, exportAudit, exportDescargas } from './export.controller.js';
import {
  stats, dashboardTendencias, listarUsuarios, crearUsuario, actualizarUsuario, eliminarUsuario, auditLog, errorLog,
  actualizarEstadoError,
  getConfiguracion, setConfiguracion, probarCorreo, reportes,
  superStats, crearAdmin, listarAdministradores, setPermisosAdminController,
  custodiaRecurso, descargasRecurso, descargasStats, scanLog,
  batchUsuarios,
} from './admin.controller.js';
import { authenticate, authorize, requireSuperAdmin } from '../../middlewares/auth.js';
import { requireModulo } from '../../middlewares/requireModulo.js';
import { csrfProtection } from '../../middlewares/csrf.js';
import { adminRateLimiter } from '../../middlewares/rateLimiter.js';

const router = Router();

// admin_sig Y super_admin acceden a todo (authorize ya lo incluye automáticamente)
// csrfProtection es un no-op en GET/HEAD, así que puede ir en la cadena común.
// requireModulo() es un no-op para super_admin y para roles que no son admin_sig —
// ver admin/modulos.service.js#tienePermisoModulo.
router.use(authenticate, authorize('admin_sig'), csrfProtection, adminRateLimiter);

router.get('/stats',              stats);
router.get('/dashboard/tendencias', dashboardTendencias);
router.get('/reportes',         requireModulo('reportes', 'ver'), reportes);
router.get('/usuarios',         requireModulo('usuarios', 'ver'), listarUsuarios);
router.post('/usuarios',        requireModulo('usuarios', 'editar'), crearUsuario);
router.patch('/usuarios/batch', requireModulo('usuarios', 'editar'), batchUsuarios); // ANTES de /:id para no conflictar
router.patch('/usuarios/:id',   requireModulo('usuarios', 'editar'), actualizarUsuario);
router.delete('/usuarios/:id',  requireModulo('usuarios', 'editar'), eliminarUsuario);
router.get('/audit',            requireModulo('actividad', 'ver'), auditLog);
router.get('/errores',          requireModulo('errores', 'ver'), errorLog);
router.patch('/errores/:id/estado', requireModulo('errores', 'editar'), actualizarEstadoError);
router.get('/configuracion',    requireModulo('configuracion', 'ver'), getConfiguracion);
router.put('/configuracion',    requireModulo('configuracion', 'editar'), setConfiguracion);

// ── Cadena de custodia y seguridad ───────────────────────────────────────────
router.get('/custodia',         custodiaRecurso);   // ?tipo=mapa&id=UUID
router.get('/descargas',        descargasRecurso);  // ?tipo=mapa&id=UUID
router.get('/descargas/stats',  descargasStats);
router.get('/scan-log',         scanLog);

// ── Rutas exclusivas de super_admin ──────────────────────────────────────────
router.get('/super/stats',              requireSuperAdmin, superStats);
router.post('/super/crear-admin',       requireSuperAdmin, crearAdmin);
router.post('/configuracion/probar-correo', requireSuperAdmin, probarCorreo);

// ── Gestión de Administradores (separada de Usuarios) — exclusiva de super_admin ──
router.get('/administradores',              requireSuperAdmin, listarAdministradores);
router.put('/administradores/:id/permisos', requireSuperAdmin, setPermisosAdminController);

// ── Exports CSV/JSON (admin_sig y super_admin) ────────────────────────────────
router.get('/export/usuarios',    requireModulo('usuarios', 'ver'), exportUsuarios);
router.get('/export/solicitudes', requireModulo('solicitudes', 'ver'), exportSolicitudes);
router.get('/export/audit',       requireModulo('actividad', 'ver'), exportAudit);
router.get('/export/descargas',   exportDescargas);

// ── Papelera (soft deletes) — solo super_admin ────────────────────────────────
router.get('/papelera',                      requireSuperAdmin, getPapelera);
router.patch('/papelera/:tipo/:id/restaurar', requireSuperAdmin, restaurar);
router.delete('/papelera/:tipo/:id',          requireSuperAdmin, purgar);

export default router;
