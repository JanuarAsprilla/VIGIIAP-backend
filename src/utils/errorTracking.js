/**
 * VIGIIAP — Registro y alerta de errores 5xx, sin depender de Sentry.
 * errorHandler.js llama a registrarError() para cada error 500+; se agrupa
 * por fingerprint (método+ruta+mensaje, normalizados) en error_log y, si no
 * se avisó a los admins por este mismo error en la última hora, se les manda
 * un correo. Mensaje y stack se redactan antes de guardarse o enviarse —
 * mismo principio que beforeSend() en instrument.js (Sentry) y
 * sanitizeSMTP() en mailer.js: un stack trace puede traer credenciales
 * (JWT en un header logueado, connection string con password, etc.) y esto
 * termina en una tabla y en un correo, no en un servicio externo con acceso
 * controlado.
 */
import crypto from 'node:crypto';
import { query } from '../config/database.js';
import { getAdminEmails } from '../modules/admin/admin.service.js';
import { notifyErrorCritico } from './mailer.js';
import logger from './logger.js';

const ALERTA_COOLDOWN_MS = 60 * 60 * 1000; // no repetir alerta del mismo error antes de 1h
const MAX_LEN = 5000; // evita blobs enormes en BD/email (stacks recursivos, etc.)

// ─── Redacción de datos sensibles ──────────────────────────────────────────
const JWT_RE = /eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g;
const BEARER_RE = /Bearer\s+\S+/gi;
const CONN_STRING_RE = /:\/\/[^:/\s]+:[^@/\s]+@/g;
// El valor capturado permite espacios (un header "Authorization: Bearer xyz"
// es UN solo valor) y solo corta en el siguiente separador real de línea —
// prefiere redactar de más (una línea completa) a dejar pasar el secreto.
const SENSITIVE_KEY_RE =
  /(password|contrase[nñ]a|token|secret|totp_secret|backup_codes|password_hash|authorization|cookie)(["']?\s*[:=]\s*["']?)([^"',;\n}]+)/gi;

function redactar(texto) {
  if (!texto) return texto;
  let limpio = String(texto)
    .replace(SENSITIVE_KEY_RE, '$1$2[REDACTED]')
    .replace(JWT_RE, '[REDACTED_JWT]')
    .replace(BEARER_RE, 'Bearer [REDACTED]')
    .replace(CONN_STRING_RE, '://[REDACTED]@');
  if (limpio.length > MAX_LEN) {
    limpio = `${limpio.slice(0, MAX_LEN)}… [truncado]`;
  }
  return limpio;
}

// ─── Agrupación por fingerprint ────────────────────────────────────────────
// Un mensaje o ruta con un id dinámico ("Usuario 4821 no existe",
// /api/v1/mapas/9f3e2a10-...) no debe crear un fingerprint distinto por cada
// valor — eso volvería inútil la agrupación, que es todo el punto de esta
// tabla. Solo afecta al hash: lo que se guarda y se muestra es el texto real.
const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
const NUMERO_RE = /\d{3,}/g;

function normalizarParaAgrupar(texto) {
  return String(texto ?? '').replace(UUID_RE, '<id>').replace(NUMERO_RE, '<n>');
}

function calcularFingerprint({ metodo, ruta, mensaje }) {
  const clave = `${metodo}:${normalizarParaAgrupar(ruta)}:${normalizarParaAgrupar(mensaje)}`;
  return crypto.createHash('sha256').update(clave).digest('hex');
}

async function alertarAdmins({ fingerprint, mensaje, metodo, ruta, ocurrencias }) {
  try {
    await query(`UPDATE error_log SET notificado_en = NOW() WHERE fingerprint = $1`, [fingerprint]);
    const adminEmails = await getAdminEmails();
    await Promise.all(
      adminEmails.map((adminEmail) =>
        notifyErrorCritico({ adminEmail, mensaje, metodo, ruta, ocurrencias }).catch((err) =>
          logger.error(`[errorTracking] Error enviando alerta a ${adminEmail}: ${err.message}`),
        ),
      ),
    );
  } catch (err) {
    logger.error(`[errorTracking] Error alertando admins: ${err.message}`);
  }
}

/** Registra un error 5xx en BD (agrupado por fingerprint) y alerta si corresponde. */
export async function registrarError({ err, metodo, ruta }) {
  const mensaje = redactar(err.message || 'Error desconocido');
  const stack = redactar(err.stack ?? null);
  const fingerprint = calcularFingerprint({ metodo, ruta, mensaje });
  const statusCode = err.status || err.statusCode || 500;

  try {
    const { rows } = await query(
      `INSERT INTO error_log (fingerprint, mensaje, stack, metodo, ruta, status_code, ocurrencias, primera_vez, ultima_vez)
       VALUES ($1, $2, $3, $4, $5, $6, 1, NOW(), NOW())
       ON CONFLICT (fingerprint) DO UPDATE
         SET ocurrencias = error_log.ocurrencias + 1, ultima_vez = NOW()
       RETURNING ocurrencias, notificado_en`,
      [fingerprint, mensaje, stack, metodo, ruta, statusCode],
    );

    const { ocurrencias, notificado_en: notificadoEn } = rows[0];
    const yaAlertado = notificadoEn && (Date.now() - new Date(notificadoEn).getTime()) < ALERTA_COOLDOWN_MS;
    if (!yaAlertado) {
      await alertarAdmins({ fingerprint, mensaje, metodo, ruta, ocurrencias });
    }
  } catch (dbErr) {
    logger.error(`[errorTracking] No se pudo registrar el error en BD: ${dbErr.message}`);
  }
}
