/**
 * emailQueue — Envío asíncrono de emails con BullMQ + Redis.
 * Retry automático: 3 intentos, backoff exponencial (2s → 4s → 8s).
 * Si Redis no está disponible, cae en envío directo como fallback.
 */
import { Queue, Worker } from 'bullmq';
import nodemailer from 'nodemailer';
import logger from './logger.js';

const REDIS_URL  = process.env.REDIS_URL ?? 'redis://localhost:6379';
const connection = { url: REDIS_URL };

let emailQueue;
let worker;

function buildTransporter() {
  return nodemailer.createTransport({
    host:   process.env.MAIL_HOST,
    port:   Number(process.env.MAIL_PORT ?? 587),
    secure: process.env.MAIL_PORT === '465',
    auth: {
      user: process.env.MAIL_USER,
      pass: process.env.MAIL_PASS,
    },
  });
}

/**
 * Inicializa la queue y el worker. Llamar una vez al arrancar el servidor.
 * Separado del módulo para facilitar el mock en tests.
 */
export function initEmailQueue() {
  if (!process.env.REDIS_URL) {
    logger.warn('[emailQueue] REDIS_URL no configurada — emails se enviarán de forma síncrona como fallback');
    return;
  }

  emailQueue = new Queue('emails', {
    connection,
    defaultJobOptions: {
      attempts: 3,
      backoff: { type: 'exponential', delay: 2000 },
      removeOnComplete: 100,
      removeOnFail: 200,
    },
  });

  const transporter = buildTransporter();

  worker = new Worker(
    'emails',
    async (job) => {
      const { to, subject, html, text } = job.data;
      await transporter.sendMail({
        from: process.env.MAIL_FROM ?? 'no-reply@iiap.gov.co',
        to, subject, html, text,
      });
      logger.info(`[emailQueue] ✉ Enviado: ${subject} → ${to} (job ${job.id})`);
    },
    {
      connection,
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: 'exponential', delay: 2000 },
        removeOnComplete: 100,
        removeOnFail: 200,
      },
    }
  );

  worker.on('failed', (job, err) => {
    logger.error(`[emailQueue] Job ${job?.id} falló definitivamente (${job?.data?.to}): ${err.message}`);
  });

  logger.info('[emailQueue] Cola BullMQ inicializada');
}

/**
 * Encola un email. Si Redis no está listo, lo envía directamente como fallback.
 * @param {{ to: string, subject: string, html: string, text?: string }} data
 */
export async function queueEmail(data) {
  if (emailQueue) {
    await emailQueue.add('send', data);
    return;
  }

  // Fallback: envío directo si Redis no está configurado
  if (!process.env.MAIL_HOST) {
    logger.warn(`[emailQueue] Sin SMTP configurado — email no enviado a ${data.to}`);
    return;
  }
  try {
    const transporter = buildTransporter();
    await transporter.sendMail({
      from: process.env.MAIL_FROM ?? 'no-reply@iiap.gov.co',
      ...data,
    });
    logger.info(`[emailQueue] ✉ Enviado (directo): ${data.subject} → ${data.to}`);
  } catch (err) {
    logger.error(`[emailQueue] Error enviando email a ${data.to}: ${err.message}`);
  }
}
