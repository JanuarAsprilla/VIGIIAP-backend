/**
 * Derechos del titular sobre su propia cuenta (Ley 1581, art. 8): acceso (exportar) y supresión (eliminar).
 *
 * Eliminar ANONIMIZA la fila de `usuarios` en vez de borrarla: otras tablas (geovisores, fichas, auditoría)
 * la referencian y borrarla perdería o impediría esos registros. La fila queda sin ningún dato que
 * identifique a la persona. El registro de auditoría es solo-anexable (hash encadenado) y conserva el correo
 * hasta su plazo de retención; ver docs/cumplimiento.
 */
import bcrypt from 'bcryptjs';
import { query, getClient } from '../../config/database.js';
import { deleteFileByUrl } from '../../config/r2.js';
import logger from '../../utils/logger.js';
import { listarConsentimientos } from './consentimientos.service.js';

export const FRASE_CONFIRMACION = 'ELIMINAR';
const ROLES_PROTEGIDOS = new Set(['super_admin', 'admin_sig']);
const LIMITE_REGISTROS_EXPORTADOS = 5000;

const fallo = (status, mensaje, code) => Object.assign(new Error(mensaje), { status, ...(code && { code }) });

/** Todo lo que la plataforma guarda sobre la persona, sin secretos (contraseña, 2FA, tokens). */
export async function exportarMisDatos(usuarioId) {
  const { rows: usuarios } = await query(
    `SELECT id, nombre, email, rol, tipo_acceso, institucion, motivo_acceso, avatar_url, oauth_provider,
            email_verified, totp_enabled, tema, creado_en, last_login_at
     FROM usuarios WHERE id = $1 AND eliminado_en IS NULL`,
    [usuarioId],
  );
  if (!usuarios[0]) throw fallo(404, 'Cuenta no encontrada');

  const [solicitudes, archivos, sesiones, notificaciones, descargas, actividad, consentimientos] = await Promise.all([
    query(
      `SELECT id, tipo, descripcion, estado, nota_admin, creado_en FROM solicitudes
       WHERE usuario_id = $1 ORDER BY creado_en DESC`,
      [usuarioId],
    ),
    query(
      `SELECT sa.solicitud_id, sa.nombre, sa.mime_type, sa.tamano_bytes, sa.creado_en
       FROM solicitud_archivos sa JOIN solicitudes s ON s.id = sa.solicitud_id
       WHERE s.usuario_id = $1 ORDER BY sa.creado_en DESC`,
      [usuarioId],
    ),
    query(
      `SELECT ip, user_agent, creado_en, expira_en FROM refresh_tokens
       WHERE usuario_id = $1 AND NOT revocado AND expira_en > NOW() ORDER BY creado_en DESC`,
      [usuarioId],
    ),
    query(
      `SELECT tipo, mensaje, creado_en, leido_en FROM notificaciones
       WHERE destinatario_id = $1 ORDER BY creado_en DESC LIMIT $2`,
      [usuarioId, LIMITE_REGISTROS_EXPORTADOS],
    ),
    query(
      `SELECT tipo_recurso, recurso_titulo, ip, created_at FROM descarga_log
       WHERE usuario_id = $1 ORDER BY created_at DESC LIMIT $2`,
      [usuarioId, LIMITE_REGISTROS_EXPORTADOS],
    ),
    query(
      `SELECT accion, modulo, descripcion, resultado, ip, creado_en FROM audit_log
       WHERE usuario_id = $1 ORDER BY creado_en DESC LIMIT $2`,
      [usuarioId, LIMITE_REGISTROS_EXPORTADOS],
    ),
    listarConsentimientos(usuarioId),
  ]);

  return {
    generadoEn: new Date().toISOString(),
    cuenta: usuarios[0],
    solicitudes: solicitudes.rows,
    archivosAdjuntos: archivos.rows,
    sesionesActivas: sesiones.rows,
    notificaciones: notificaciones.rows,
    descargas: descargas.rows,
    actividad: actividad.rows,
    consentimientos,
    nota: `Se incluyen hasta ${LIMITE_REGISTROS_EXPORTADOS} registros por sección, los más recientes.`,
  };
}

/**
 * Anonimiza la cuenta del titular y borra lo que es puramente personal. Requiere escribir la frase de
 * confirmación y, si la cuenta tiene contraseña, la contraseña. Las cuentas administrativas no se
 * autoeliminan: las gestiona un Super Administrador (su contenido está enlazado a otros registros).
 */
export async function eliminarMiCuenta({ usuarioId, confirmacion, password }) {
  if (confirmacion !== FRASE_CONFIRMACION) {
    throw fallo(400, `Escribe ${FRASE_CONFIRMACION} para confirmar la eliminación de tu cuenta`);
  }

  const cliente = await getClient();
  let urlsArchivos;
  try {
    await cliente.query('BEGIN');

    const { rows } = await cliente.query(
      'SELECT id, rol, password_hash, avatar_url, email, eliminado_en FROM usuarios WHERE id = $1 FOR UPDATE',
      [usuarioId],
    );
    const usuario = rows[0];
    if (!usuario || usuario.eliminado_en) throw fallo(404, 'Cuenta no encontrada');
    if (ROLES_PROTEGIDOS.has(usuario.rol)) {
      throw fallo(403, 'Las cuentas administrativas las elimina un Super Administrador. Escribe a la administración de la plataforma.', 'CUENTA_ADMINISTRATIVA');
    }
    if (usuario.password_hash) {
      const coincide = typeof password === 'string' && password !== '' && await bcrypt.compare(password, usuario.password_hash);
      if (!coincide) throw fallo(401, 'Contraseña incorrecta');
    }

    const { rows: adjuntos } = await cliente.query(
      `SELECT sa.url FROM solicitud_archivos sa JOIN solicitudes s ON s.id = sa.solicitud_id WHERE s.usuario_id = $1`,
      [usuarioId],
    );
    urlsArchivos = [...adjuntos.map((a) => a.url), usuario.avatar_url].filter(Boolean);

    // Lo puramente personal se borra.
    await cliente.query('DELETE FROM solicitudes WHERE usuario_id = $1', [usuarioId]); // arrastra solicitud_archivos
    await cliente.query('DELETE FROM notificaciones WHERE destinatario_id = $1', [usuarioId]);
    await cliente.query('DELETE FROM usuario_notificacion_prefs WHERE usuario_id = $1', [usuarioId]);
    await cliente.query('DELETE FROM refresh_tokens WHERE usuario_id = $1', [usuarioId]);
    await cliente.query('DELETE FROM correos_pendientes WHERE lower(destinatario) = lower($1)', [usuario.email]);

    // Los registros de custodia se conservan, sin lo que identifica a la persona.
    await cliente.query('UPDATE descarga_log SET usuario_email = NULL, ip = NULL WHERE usuario_id = $1', [usuarioId]);
    await cliente.query('UPDATE geo_custodia SET usuario_email = NULL, ip = NULL WHERE usuario_id = $1', [usuarioId]);
    await cliente.query('UPDATE file_scan_log SET ip_origen = NULL WHERE uploaded_by = $1', [usuarioId]);
    // De la prueba de autorización se conservan versión y fecha; se retira lo que identifica.
    await cliente.query('UPDATE consentimientos SET ip = NULL, user_agent = NULL WHERE usuario_id = $1', [usuarioId]);

    await cliente.query(
      `UPDATE usuarios SET
         nombre = 'Cuenta eliminada', email = $2, password_hash = NULL, rol = 'publico', rol_solicitado = NULL,
         institucion = NULL, motivo_acceso = NULL, activo = false, avatar_url = NULL,
         oauth_provider = NULL, oauth_id = NULL,
         totp_secret = NULL, totp_enabled = false, totp_backup_codes = NULL,
         email_verification_token = NULL, email_verification_expires = NULL,
         password_reset_token = NULL, password_reset_expires = NULL, expired_token_jti = NULL,
         tema = NULL, eliminado_en = NOW(), actualizado_en = NOW()
       WHERE id = $1`,
      [usuarioId, `eliminado-${usuarioId}@cuenta-eliminada.invalid`],
    );

    await cliente.query('COMMIT');
  } catch (err) {
    await cliente.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    cliente.release();
  }

  // Los archivos se borran después de confirmar: si fallan, la cuenta ya quedó anonimizada y solo se avisa.
  await Promise.all(urlsArchivos.map((url) =>
    deleteFileByUrl(url).catch((err) => logger.warn(`[cuenta] No se pudo borrar un archivo de ${usuarioId}: ${err.message}`))));

  return { eliminada: true };
}
