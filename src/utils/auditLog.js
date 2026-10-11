/**
 * VIGIIAP — Registro de auditoría
 * Inserta registros en la tabla audit_log de forma no bloqueante.
 */
import { query } from '../config/database.js';
import logger from './logger.js';
import { contextoActual } from './contextoPeticion.js';

/**
 * Correo parcialmente oculto para registrar intentos contra cuentas que no existen
 * ("ab***@iiap.org.co"): sirve para reconocer el patrón sin guardar el dato completo.
 */
export function enmascararEmail(email) {
  const texto = String(email ?? '').trim().toLowerCase().slice(0, 254);
  const arroba = texto.lastIndexOf('@');
  if (arroba < 1) return '***';
  return `${texto.slice(0, Math.min(2, arroba))}***${texto.slice(arroba)}`;
}

/**
 * @param {object} params
 * @param {string} params.accion     - 'login', 'registro', 'create_usuario', etc.
 * @param {string} params.modulo     - 'auth', 'usuarios', 'solicitudes', etc.
 * @param {string} [params.entidadId]
 * @param {string} [params.descripcion]
 * @param {string} [params.usuarioId]
 * @param {string} [params.usuarioEmail]
 * @param {string} [params.ip]
 * @param {string} [params.userAgent]
 * @param {'exito'|'fallo'|'denegado'} [params.resultado]
 * @param {object} [params.cambios]     - { campo: { antes, despues } } (ver utils/cambios.js)
 * @param {string} [params.entidadTipo] - 'usuario', 'geovisor', ...
 * @param {string} [params.requestId]
 *
 * IP, navegador, ID de petición y usuario se completan solos con los de la petición en curso
 * cuando el llamador no los indica (ver contextoPeticion.js); lo explícito siempre manda.
 */
export async function registrarAuditoria({
  accion,
  modulo,
  entidadId = null,
  descripcion = null,
  usuarioId = null,
  usuarioEmail = null,
  ip = null,
  userAgent = null,
  resultado = 'exito',
  cambios = null,
  entidadTipo = null,
  requestId = null,
}) {
  try {
    const contexto = contextoActual();
    await query(
      `INSERT INTO audit_log (accion, modulo, entidad_id, descripcion, usuario_id, usuario_email, ip, user_agent,
                              resultado, request_id, cambios, entidad_tipo)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12)`,
      [
        accion, modulo, entidadId, descripcion,
        usuarioId ?? contexto?.usuarioId ?? null,
        usuarioEmail ?? contexto?.usuarioEmail ?? null,
        ip ?? contexto?.ip ?? null,
        userAgent ?? contexto?.userAgent ?? null,
        resultado,
        requestId ?? contexto?.requestId ?? null,
        cambios ? JSON.stringify(cambios) : null,
        entidadTipo,
      ]
    );
  } catch (err) {
    // No romper el flujo principal si falla el log
    logger.warn(`[auditLog] Error registrando auditoría (${accion}):`, err.message);
  }
}
