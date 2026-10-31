import { query } from '../config/database.js';
import logger from './logger.js';

/**
 * Cola de reintentos de correo (patrón outbox). `mailer.send` intenta enviar de inmediato y solo
 * si falla deja aquí el correo; un trabajador lo reintenta con espera creciente. Un correo enviado
 * con éxito a la primera nunca se guarda, y al terminar (enviado o agotado) se borra su cuerpo.
 */
export const MAX_INTENTOS = 5;
const ESPERAS_MIN = [1, 5, 30, 120, 360];
const LOTE = 10;
const ARRENDAMIENTO_MIN = 5;
const INTERVALO_MS = 60_000;
const DIAS_RETENCION = 14;
const ERROR_MAX = 500;

let manejador = null;
let procesando = false;

/** Un rechazo permanente del servidor (5xx) no mejora reintentando; un fallo de red o 4xx sí. */
export function esReintentable(err) {
  if (err?.code === 'EAUTH') return true; // el administrador puede corregir la configuración
  const codigo = err?.responseCode;
  return !(codigo >= 500 && codigo < 600);
}

export function esperaMinutos(intento) {
  return ESPERAS_MIN[Math.min(Math.max(intento, 1), ESPERAS_MIN.length) - 1];
}

function mensajeDe(err) {
  return String(err?.message ?? err).slice(0, ERROR_MAX);
}

/** Guarda un correo cuyo primer envío falló; el primer reintento será en un minuto. */
export async function encolarFallo({ to, subject, html, error }) {
  await query(
    `INSERT INTO correos_pendientes (destinatario, asunto, html, intentos, proximo_intento_en, ultimo_error)
     VALUES ($1, $2, $3, 1, NOW() + make_interval(mins => $4), $5)`,
    [to, subject, html, esperaMinutos(1), mensajeDe(error)],
  );
}

async function marcarEnviado(id) {
  await query(
    `UPDATE correos_pendientes SET estado = 'enviado', html = NULL, actualizado_en = NOW() WHERE id = $1`,
    [id],
  );
}

async function marcarFallido(id, intentos, error) {
  await query(
    `UPDATE correos_pendientes SET estado = 'fallido', html = NULL, intentos = $2, ultimo_error = $3, actualizado_en = NOW()
     WHERE id = $1`,
    [id, intentos, mensajeDe(error)],
  );
}

async function reprogramar(id, intentos, error) {
  await query(
    `UPDATE correos_pendientes
     SET estado = 'pendiente', intentos = $2, proximo_intento_en = NOW() + make_interval(mins => $3),
         ultimo_error = $4, actualizado_en = NOW()
     WHERE id = $1`,
    [id, intentos, esperaMinutos(intentos), mensajeDe(error)],
  );
}

/**
 * Reclama un lote (con SKIP LOCKED, seguro con varias instancias) dándole un arrendamiento: si el
 * proceso muere a media tarea, el correo vuelve a estar disponible al vencer. Envía fuera de
 * cualquier transacción y registra el resultado de cada uno sin que un fallo frene a los demás.
 */
export async function procesarPendientes(enviar) {
  const { rows } = await query(
    `UPDATE correos_pendientes
     SET proximo_intento_en = NOW() + make_interval(mins => $2)
     WHERE id IN (
       SELECT id FROM correos_pendientes
       WHERE estado = 'pendiente' AND proximo_intento_en <= NOW()
       ORDER BY proximo_intento_en
       LIMIT $1
       FOR UPDATE SKIP LOCKED
     )
     RETURNING id, destinatario, asunto, html, intentos`,
    [LOTE, ARRENDAMIENTO_MIN],
  );

  const resultado = { enviados: 0, reprogramados: 0, fallidos: 0 };
  for (const fila of rows) {
    try {
      await enviar({ to: fila.destinatario, subject: fila.asunto, html: fila.html });
      await marcarEnviado(fila.id);
      resultado.enviados += 1;
    } catch (err) {
      const intentos = fila.intentos + 1;
      if (!esReintentable(err) || intentos >= MAX_INTENTOS) {
        await marcarFallido(fila.id, intentos, err);
        resultado.fallidos += 1;
        logger.warn(`[correos] Correo ${fila.id} descartado tras ${intentos} intento(s): ${mensajeDe(err)}`);
      } else {
        await reprogramar(fila.id, intentos, err);
        resultado.reprogramados += 1;
      }
    }
  }

  await query(
    `DELETE FROM correos_pendientes WHERE creado_en < NOW() - make_interval(days => $1)`,
    [DIAS_RETENCION],
  );
  return resultado;
}

async function ejecutarSinFallar(enviar) {
  if (procesando) return;
  procesando = true;
  try {
    const r = await procesarPendientes(enviar);
    if (r.enviados || r.reprogramados || r.fallidos) {
      logger.info(`[correos] Reintentos: enviados ${r.enviados}, reprogramados ${r.reprogramados}, descartados ${r.fallidos}`);
    }
  } catch (err) {
    logger.warn(`[correos] Error procesando la cola: ${err.message}`);
  } finally {
    procesando = false;
  }
}

/** Revisa la cola al arrancar y luego cada minuto. `enviar` debe rechazar la promesa si falla. */
export function startOutboxCorreos(enviar, intervaloMs = INTERVALO_MS) {
  stopOutboxCorreos();
  ejecutarSinFallar(enviar);
  manejador = setInterval(() => ejecutarSinFallar(enviar), intervaloMs);
  manejador.unref?.();
  return manejador;
}

export function stopOutboxCorreos() {
  if (manejador) {
    clearInterval(manejador);
    manejador = null;
  }
}
