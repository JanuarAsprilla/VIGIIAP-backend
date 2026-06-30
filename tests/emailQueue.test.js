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

vi.mock('bullmq', () => {
  function Queue(name, opts) {
    this.name = name;
    this.add  = vi.fn().mockResolvedValue({ id: 'job-1' });
  }
  function Worker(name, processor, opts) {
    this.name = name;
    this.on   = vi.fn();
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
