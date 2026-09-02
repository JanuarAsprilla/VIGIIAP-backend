/**
 * VIGIIAP — Registro y alerta de errores 5xx, sin depender de Sentry.
 * errorHandler.js llama a registrarError() para cada error 500+; se agrupa
 * por fingerprint (método+ruta+mensaje) en error_log y, si no se avisó a los
 * admins por este mismo error en la última hora, se les manda un correo.
 */
import crypto from 'node:crypto';
import { query } from '../config/database.js';
import { getAdminEmails } from '../modules/admin/admin.service.js';
import { notifyErrorCritico } from './mailer.js';
import logger from './logger.js';

const ALERTA_COOLDOWN_MS = 60 * 60 * 1000; // no repetir alerta del mismo error antes de 1h

function calcularFingerprint({ metodo, ruta, mensaje }) {
  return crypto.createHash('sha256').update(`${metodo}:${ruta}:${mensaje}`).digest('hex');
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
  const mensaje = err.message || 'Error desconocido';
  const fingerprint = calcularFingerprint({ metodo, ruta, mensaje });
  const statusCode = err.status || err.statusCode || 500;

  try {
    const { rows } = await query(
      `INSERT INTO error_log (fingerprint, mensaje, stack, metodo, ruta, status_code, ocurrencias, primera_vez, ultima_vez)
       VALUES ($1, $2, $3, $4, $5, $6, 1, NOW(), NOW())
       ON CONFLICT (fingerprint) DO UPDATE
         SET ocurrencias = error_log.ocurrencias + 1, ultima_vez = NOW()
       RETURNING ocurrencias, notificado_en`,
      [fingerprint, mensaje, err.stack ?? null, metodo, ruta, statusCode],
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
