import { z } from 'zod';
import { registrarAuditoria } from '../../utils/auditLog.js';
import { revokeToken } from '../../utils/tokenBlacklist.js';
import {
  COOKIE_NAME, REFRESH_COOKIE_NAME, clearCookieOptions, clearRefreshCookieOptions,
} from '../../utils/cookieOptions.js';
import { exportarMisDatos, eliminarMiCuenta } from './cuenta.service.js';

const eliminarSchema = z.object({
  confirmacion: z.string().max(40),
  password: z.string().max(72).optional(),
});

/** GET /usuarios/me/datos — descarga todo lo que la plataforma guarda de la persona. */
export async function exportar(req, res, next) {
  try {
    const datos = await exportarMisDatos(req.user.id);
    registrarAuditoria({
      accion: 'export_datos_propios', modulo: 'usuarios', entidadId: req.user.id,
      descripcion: 'El titular descargó sus datos personales',
      usuarioId: req.user.id, usuarioEmail: req.user.email, ip: req.ip,
    });
    res.setHeader('Content-Disposition', 'attachment; filename="mis-datos-vigiiap.json"');
    res.setHeader('Cache-Control', 'no-store');
    res.json(datos);
  } catch (err) { next(err); }
}

/** DELETE /usuarios/me — anonimiza la cuenta del titular y cierra su sesión. */
export async function eliminar(req, res, next) {
  try {
    const { confirmacion, password } = eliminarSchema.parse(req.body ?? {});
    await eliminarMiCuenta({ usuarioId: req.user.id, confirmacion, password });

    // Sin correo ni nombre en el registro: la cuenta acaba de dejar de identificar a la persona.
    registrarAuditoria({
      accion: 'cuenta_eliminada', modulo: 'usuarios', entidadId: req.user.id,
      descripcion: 'El titular eliminó su cuenta (anonimizada)',
      usuarioId: req.user.id, ip: req.ip,
    });

    const token = req.cookies?.[COOKIE_NAME] ?? req.headers.authorization?.slice(7);
    if (token) await revokeToken(token, req.user.exp ?? Math.floor(Date.now() / 1000) + 15 * 60);
    res.clearCookie(COOKIE_NAME, clearCookieOptions());
    res.clearCookie(REFRESH_COOKIE_NAME, clearRefreshCookieOptions());
    res.json({ message: 'Tu cuenta fue eliminada. Gracias por haber usado VIGIA-IIAP.' });
  } catch (err) { next(err); }
}
