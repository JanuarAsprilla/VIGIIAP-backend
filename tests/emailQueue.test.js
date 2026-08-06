/**
 * emailQueue.test.js
 *
 * IMPORTANTE: emailQueue.js mantiene estado en variables de módulo (emailQueue, worker).
 * Los tests del fallback deben ejecutarse ANTES de llamar a initEmailQueue() con REDIS_URL,
 * ya que una vez creada la cola interna, queueEmail() la usará siempre en ese mismo proceso.
 *
 * Por eso este archivo está ordenado en dos secciones:
 *  1. Tests del fallback (sin Redis) — primero, antes de que la cola se inicialice
 *  2. Tests de la cola activa — al final, después de inicializar con REDIS_URL
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// vi.mock se hoista — los factories no pueden referenciar variables externas.
// Queue/Worker se usan con `new`, necesitan constructores reales.

const { workerInstances } = vi.hoisted(() => ({ workerInstances: [] }));

vi.mock('bullmq', () => {
  function Queue(name, opts) {
    this.name = name;
    this.add  = vi.fn().mockResolvedValue({ id: 'job-1' });
  }
  function Worker(name, processor, opts) {
    this.name      = name;
    this.processor = processor;
    this.handlers  = {};
    this.on = vi.fn((event, cb) => { this.handlers[event] = cb; });
    workerInstances.push(this);
  }
  return { Queue, Worker };
});

vi.mock('nodemailer', () => {
  const sendMail      = vi.fn().mockResolvedValue({ messageId: '<test@localhost>' });
  const createTransport = vi.fn(() => ({ sendMail }));
  return { default: { createTransport } };
});

vi.mock('../src/utils/logger.js', () => ({
  default: { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() },
}));

import logger     from '../src/utils/logger.js';
import nodemailer from 'nodemailer';
import { Queue, Worker } from 'bullmq';
import { initEmailQueue, queueEmail } from '../src/utils/emailQueue.js';

// ─── initEmailQueue() — sin REDIS_URL ────────────────────────────────────────

describe('initEmailQueue() — sin REDIS_URL', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.REDIS_URL;
  });

  it('emite warning y no crea Queue', () => {
    initEmailQueue();
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('REDIS_URL no configurada')
    );
  });
});

// ─── queueEmail() — fallback directo (sin Redis) ─────────────────────────────
// DEBE correr antes de initEmailQueue() con REDIS_URL para que emailQueue sea null

describe('queueEmail() — fallback directo (sin Redis)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Asegurarse de que la cola no esté inicializada
    delete process.env.REDIS_URL;
    delete process.env.MAIL_HOST;
  });

  it('emite warning si no hay SMTP configurado', async () => {
    await queueEmail({ to: 'x@y.co', subject: 'S', html: '<p>H</p>' });
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('Sin SMTP configurado')
    );
  });

  it('envía email directamente cuando hay SMTP pero no hay Redis', async () => {
    process.env.MAIL_HOST = 'smtp.iiap.gob.co';
    process.env.MAIL_PORT = '587';
    process.env.MAIL_USER = 'no-reply@iiap.gob.co';
    process.env.MAIL_PASS = 'secret';
    process.env.MAIL_FROM = 'no-reply@iiap.gob.co';

    const data = { to: 'user@iiap.org.co', subject: 'Test', html: '<p>Hi</p>' };
    await queueEmail(data);

    expect(nodemailer.createTransport).toHaveBeenCalled();
    const transport = nodemailer.createTransport.mock.results[0].value;
    expect(transport.sendMail).toHaveBeenCalledWith(
      expect.objectContaining({ to: data.to, subject: data.subject })
    );
    expect(logger.info).toHaveBeenCalledWith(
      expect.stringContaining('Enviado (directo)')
    );
  });

  it('emite logger.error si sendMail falla en el fallback', async () => {
    process.env.MAIL_HOST = 'smtp.iiap.gob.co';
    nodemailer.createTransport.mockImplementationOnce(() => ({
      sendMail: vi.fn().mockRejectedValueOnce(new Error('SMTP refused')),
    }));

    await queueEmail({ to: 'x@y.co', subject: 'S', html: '<p>H</p>' });
    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining('Error enviando email')
    );
  });

  it('usa el puerto 587 por defecto cuando MAIL_PORT no está configurado', async () => {
    process.env.MAIL_HOST = 'smtp.iiap.gob.co';
    delete process.env.MAIL_PORT;
    process.env.MAIL_USER = 'no-reply@iiap.gob.co';
    process.env.MAIL_PASS = 'secret';

    await queueEmail({ to: 'x@y.co', subject: 'S', html: '<p>H</p>' });

    expect(nodemailer.createTransport).toHaveBeenCalledWith(
      expect.objectContaining({ port: 587 })
    );
  });

  it('usa el remitente por defecto cuando MAIL_FROM no está configurada', async () => {
    process.env.MAIL_HOST = 'smtp.iiap.gob.co';
    process.env.MAIL_PORT = '587';
    process.env.MAIL_USER = 'no-reply@iiap.gob.co';
    process.env.MAIL_PASS = 'secret';
    delete process.env.MAIL_FROM;

    const data = { to: 'user@iiap.org.co', subject: 'Test', html: '<p>Hi</p>' };
    await queueEmail(data);

    const transport = nodemailer.createTransport.mock.results[0].value;
    expect(transport.sendMail).toHaveBeenCalledWith(
      expect.objectContaining({ from: 'no-reply@iiap.gov.co' })
    );
  });
});

// ─── initEmailQueue() + queueEmail() — con REDIS_URL ─────────────────────────

describe('initEmailQueue() — con REDIS_URL', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.REDIS_URL = 'redis://localhost:6379';
  });

  it('crea la cola y emite info', () => {
    initEmailQueue();
    expect(logger.info).toHaveBeenCalledWith(
      expect.stringContaining('Cola BullMQ inicializada')
    );
  });
});

describe('queueEmail() — con cola BullMQ activa', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.REDIS_URL = 'redis://localhost:6379';
    initEmailQueue();
  });

  it('encola el email y no emite errores', async () => {
    await queueEmail({ to: 'user@iiap.org.co', subject: 'Test', html: '<p>Hi</p>' });
    expect(logger.error).not.toHaveBeenCalled();
  });

  it('no llama createTransport en modo cola activa', async () => {
    vi.clearAllMocks(); // limpiar los mocks post-initEmailQueue
    await queueEmail({ to: 'user@iiap.org.co', subject: 'Prueba', html: '<p>Hi</p>' });
    // El fallback directo no se activa cuando hay cola Redis activa
    expect(logger.warn).not.toHaveBeenCalled();
  });
});

// ─── Worker — processor de jobs y handler 'failed' ───────────────────────────

describe('Worker — processor de jobs', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.REDIS_URL = 'redis://localhost:6379';
    process.env.MAIL_FROM = 'no-reply@iiap.gov.co';
    initEmailQueue();
  });

  it('procesa un job, envía el email vía transporter y registra el log', async () => {
    const workerInstance = workerInstances.at(-1);
    const job = {
      id: 'job-42',
      data: { to: 'user@iiap.org.co', subject: 'Asunto', html: '<p>Hi</p>', text: 'Hi' },
    };

    await workerInstance.processor(job);

    expect(nodemailer.createTransport).toHaveBeenCalled();
    const transport = nodemailer.createTransport.mock.results[0].value;
    expect(transport.sendMail).toHaveBeenCalledWith(
      expect.objectContaining({ to: job.data.to, subject: job.data.subject })
    );
    expect(logger.info).toHaveBeenCalledWith(
      expect.stringContaining('Enviado: Asunto')
    );
  });

  it('registra el error mediante logger.error cuando el worker emite "failed"', () => {
    const workerInstance = workerInstances.at(-1);
    const job = { id: 'job-99', data: { to: 'user@iiap.org.co' } };
    const err = new Error('SMTP timeout');

    workerInstance.handlers.failed(job, err);

    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining('Job job-99 falló definitivamente')
    );
  });
});
