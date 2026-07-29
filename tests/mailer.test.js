/**
 * Tests para utils/mailer.js
 * Foco: remitente dinámico desde BD, sanitización SMTP/HTML, flujos básicos.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ── sendMail spy ──────────────────────────────────────────────────────────────
const sendMailSpy = vi.fn().mockResolvedValue({ messageId: 'test-id' });

vi.mock('nodemailer', () => ({
  default: {
    createTransport: vi.fn(() => ({ sendMail: sendMailSpy })),
  },
}));

vi.mock('../src/config/database.js', () => ({
  query: vi.fn(),
}));

vi.mock('../src/utils/logger.js', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { query } from '../src/config/database.js';
import {
  notifySolicitudEstado,
  notifyAdminNuevaSolicitud,
  notifySolicitudRecibida,
  notifyVerificacionEmail,
  notifyRecuperarPassword,
} from '../src/utils/mailer.js';

// Credenciales mínimas para que send() no salga temprano
const MAIL_ENV = { MAIL_USER: 'test@iiap.gov.co', MAIL_PASS: 'pass', MAIL_HOST: 'smtp.test.co' };

beforeEach(() => {
  vi.clearAllMocks();
  Object.assign(process.env, MAIL_ENV);
  // BD devuelve config vacía por defecto — mailer usa env var
  query.mockResolvedValue({ rows: [] });
});

afterEach(() => {
  delete process.env.MAIL_FROM;
  delete process.env.MAIL_USER;
  delete process.env.MAIL_PASS;
  delete process.env.MAIL_HOST;
});

// ── Remitente dinámico ────────────────────────────────────────────────────────

describe('getFromAddress() — remitente dinámico', () => {
  it('usa MAIL_FROM cuando está definida (mayor prioridad)', async () => {
    process.env.MAIL_FROM = '"IIAP Prod" <prod@iiap.gov.co>';

    await notifySolicitudEstado({
      email: 'u@test.co', nombre: 'U', tipo: 'uso-suelo', estado: 'aprobada',
    });

    const call = sendMailSpy.mock.calls[0]?.[0];
    expect(call?.from).toBe('"IIAP Prod" <prod@iiap.gov.co>');
  });

  it('lee mail_remitente y mail_remitente_nombre de BD cuando no hay MAIL_FROM', async () => {
    delete process.env.MAIL_FROM;
    query.mockResolvedValue({
      rows: [
        { clave: 'mail_remitente',        valor: 'custom@iiap.gov.co' },
        { clave: 'mail_remitente_nombre', valor: 'Custom IIAP' },
      ],
    });

    await notifySolicitudRecibida({ email: 'u@test.co', nombre: 'U', tipo: 'uso-suelo' });

    const call = sendMailSpy.mock.calls[0]?.[0];
    expect(call?.from).toContain('custom@iiap.gov.co');
    expect(call?.from).toContain('Custom IIAP');
  });

  it('usa fallback seguro cuando la BD no responde', async () => {
    delete process.env.MAIL_FROM;
    query.mockRejectedValue(new Error('connection refused'));

    await expect(
      notifyVerificacionEmail({ nombre: 'U', email: 'u@test.co', verificationToken: 'a'.repeat(64) }),
    ).resolves.toBeUndefined();

    // Debe haber enviado igualmente con el fallback
    expect(sendMailSpy).toHaveBeenCalled();
    expect(sendMailSpy.mock.calls[0][0].from).toContain('iiap.gov.co');
  });

  it('omite el envío silenciosamente cuando faltan credenciales SMTP', async () => {
    delete process.env.MAIL_USER;
    delete process.env.MAIL_PASS;

    await notifySolicitudEstado({
      email: 'u@test.co', nombre: 'U', tipo: 'otro', estado: 'aprobada',
    });

    expect(sendMailSpy).not.toHaveBeenCalled();
  });
});

// ── Sanitización SMTP ─────────────────────────────────────────────────────────

describe('Sanitización SMTP — prevención de header injection', () => {
  it('elimina CRLF de campos que van a headers SMTP (subject, from)', async () => {
    await notifyAdminNuevaSolicitud({
      adminEmail:  'admin@iiap.gov.co',
      solicitante: 'Juan\r\nBcc: evil@attacker.com',
      email:       'victim@test.co',
      tipo:        'otro',
      descripcion: 'desc normal',
    });

    const { subject, from } = sendMailSpy.mock.calls[0]?.[0] ?? {};
    // Los headers no deben contener secuencias CRLF — eso abriría header injection
    expect(subject).not.toMatch(/\r|\n/);
    expect(from).not.toMatch(/\r|\n/);
  });

  it('escapa etiquetas HTML en datos del usuario embebidos en el cuerpo del email', async () => {
    await notifySolicitudEstado({
      email:  'u@test.co',
      nombre: '<script>alert("xss")</script>',
      tipo:   'otro',
      estado: 'aprobada',
    });

    const { html } = sendMailSpy.mock.calls[0]?.[0] ?? {};
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });
});

// ── Flujos de negocio ─────────────────────────────────────────────────────────

describe('notifyVerificacionEmail()', () => {
  it('envía al destinatario correcto con el token en el body', async () => {
    const token = 'a'.repeat(64);
    await notifyVerificacionEmail({ nombre: 'Jana', email: 'j@test.co', verificationToken: token });

    const call = sendMailSpy.mock.calls[0]?.[0];
    expect(call?.to).toBe('j@test.co');
    expect(call?.html).toContain(token);
  });
});

describe('notifyRecuperarPassword()', () => {
  it('envía al destinatario con el token de reset en el body', async () => {
    const token = 'b'.repeat(64);
    await notifyRecuperarPassword({ nombre: 'Tomas', email: 't@test.co', resetToken: token });

    const call = sendMailSpy.mock.calls[0]?.[0];
    expect(call?.to).toBe('t@test.co');
    expect(call?.html).toContain(token);
  });
});

describe('notifySolicitudEstado()', () => {
  it('incluye el nuevo estado en el cuerpo del email', async () => {
    await notifySolicitudEstado({
      email: 'u@test.co', nombre: 'U', tipo: 'linderos', estado: 'rechazada', nota: 'Documentación incompleta',
    });

    const { html, to } = sendMailSpy.mock.calls[0]?.[0] ?? {};
    expect(to).toBe('u@test.co');
    expect(html).toMatch(/rechazada/i);
  });

  it('no lanza cuando nota es undefined', async () => {
    await expect(
      notifySolicitudEstado({ email: 'u@test.co', nombre: 'U', tipo: 'otro', estado: 'aprobada' }),
    ).resolves.toBeUndefined();
  });
});

describe('notifyAdminNuevaSolicitud()', () => {
  it('envía al email del admin con el tipo de solicitud', async () => {
    await notifyAdminNuevaSolicitud({
      adminEmail:  'admin@iiap.gov.co',
      solicitante: 'Carlos',
      email:       'carlos@test.co',
      tipo:        'estudio-ambiental',
      descripcion: 'Evaluación de impacto ambiental Zona Norte',
    });

    const { to, html } = sendMailSpy.mock.calls[0]?.[0] ?? {};
    expect(to).toBe('admin@iiap.gov.co');
    expect(html).toContain('Carlos');
  });
});
