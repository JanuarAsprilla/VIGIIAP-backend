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

import nodemailer from 'nodemailer';
import logger from '../src/utils/logger.js';
import { query } from '../src/config/database.js';
import {
  notifySolicitudEstado,
  notifyAdminNuevaSolicitud,
  notifySolicitudRecibida,
  notifyVerificacionEmail,
  notifyRecuperarPassword,
  notifyAdminNewRegistro,
  notifyUsuarioActivacion,
  notifyUsuarioCreado,
  notifyRegistroRecibido,
  notifyAdminUsuarioVerificado,
  notifySolicitudRespuesta,
  notifyRolCambiado,
  notifyNuevoInicioSesion,
  notifyReporteSemanal,
  notifyErrorCritico,
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

  it('usa el tipo crudo en subject y cuerpo cuando no existe en TIPO_LABEL', async () => {
    await notifyAdminNuevaSolicitud({
      adminEmail:  'admin@iiap.gov.co',
      solicitante: 'Carlos',
      email:       'carlos@test.co',
      tipo:        'tipo-inexistente',
      descripcion: 'desc',
    });

    const { subject, html } = sendMailSpy.mock.calls[0]?.[0] ?? {};
    expect(subject).toContain('tipo-inexistente');
    expect(html).toContain('tipo-inexistente');
  });
});

// ── sanitizeSMTP() — directa, vía funciones que la usan ────────────────────────

describe('notifyAdminNewRegistro()', () => {
  it('envía al admin con institución y motivo escapados cuando están presentes', async () => {
    await notifyAdminNewRegistro({
      adminEmail:  'admin@iiap.gov.co',
      nombre:      'Nuevo Usuario',
      email:       'nuevo@test.co',
      institucion: 'Universidad <del Pacífico>',
      motivo:      'Investigación',
    });

    const { to, subject, html } = sendMailSpy.mock.calls[0]?.[0] ?? {};
    expect(to).toBe('admin@iiap.gov.co');
    expect(subject).toContain('Nuevo Usuario');
    expect(html).toContain('&lt;del Pacífico&gt;');
    expect(html).toContain('Investigación');
  });

  it('usa los valores por defecto cuando institución y motivo están vacíos', async () => {
    await notifyAdminNewRegistro({
      adminEmail:  'admin@iiap.gov.co',
      nombre:      'Otro Usuario',
      email:       'otro@test.co',
      institucion: '',
      motivo:      '',
    });

    const { html } = sendMailSpy.mock.calls[0]?.[0] ?? {};
    expect(html).toContain('No especificada');
    expect(html).toContain('No especificado');
  });

  it('elimina CRLF del nombre en el subject vía sanitizeSMTP', async () => {
    await notifyAdminNewRegistro({
      adminEmail:  'admin@iiap.gov.co',
      nombre:      'Ana\r\nBcc: evil@attacker.com',
      email:       'ana@test.co',
      institucion: 'IIAP',
      motivo:      'Trabajo',
    });

    const { subject } = sendMailSpy.mock.calls[0]?.[0] ?? {};
    expect(subject).not.toMatch(/\r|\n/);
  });

  it('trunca valores de sanitizeSMTP a 250 caracteres', async () => {
    await notifyAdminNewRegistro({
      adminEmail:  'admin@iiap.gov.co',
      nombre:      'N'.repeat(400),
      email:       'largo@test.co',
      institucion: 'IIAP',
      motivo:      'Trabajo',
    });

    const { subject } = sendMailSpy.mock.calls[0]?.[0] ?? {};
    // "[VIGI-IIAP] Nuevo registro: " + hasta 250 caracteres de nombre truncado
    expect(subject.length).toBeLessThanOrEqual('[VIGI-IIAP] Nuevo registro: '.length + 250);
  });
});

describe('notifyUsuarioActivacion()', () => {
  it('notifica activación con rol conocido y muestra el CTA de ingreso', async () => {
    await notifyUsuarioActivacion({
      email: 'u@test.co', nombre: 'Usuario Activo', activo: true, rol: 'admin_sig',
    });

    const { to, subject, html } = sendMailSpy.mock.calls[0]?.[0] ?? {};
    expect(to).toBe('u@test.co');
    expect(subject).toContain('activada');
    expect(html).toContain('Administrador SIG');
    expect(html).toContain('Ingresar al portal');
  });

  it('notifica desactivación sin el CTA de ingreso', async () => {
    await notifyUsuarioActivacion({
      email: 'u@test.co', nombre: 'Usuario Inactivo', activo: false, rol: 'admin_sig',
    });

    const { subject, html } = sendMailSpy.mock.calls[0]?.[0] ?? {};
    expect(subject).toContain('desactivada');
    expect(html).not.toContain('Ingresar al portal');
  });

  it('usa el rol crudo en el cuerpo cuando no está en el mapa de labels', async () => {
    await notifyUsuarioActivacion({
      email: 'u@test.co', nombre: 'Usuario Rol Custom', activo: true, rol: 'rol-custom',
    });

    const { html } = sendMailSpy.mock.calls[0]?.[0] ?? {};
    expect(html).toContain('rol-custom');
  });
});

describe('notifyUsuarioCreado()', () => {
  it('envía credenciales con la contraseña temporal escapada', async () => {
    await notifyUsuarioCreado({
      email: 'creado@test.co',
      nombre: 'Creado',
      passwordTemporal: '<script>pwd</script>',
      rol: 'investigador',
    });

    const { to, html } = sendMailSpy.mock.calls[0]?.[0] ?? {};
    expect(to).toBe('creado@test.co');
    expect(html).toContain('Investigador');
    expect(html).not.toContain('<script>pwd</script>');
    expect(html).toContain('&lt;script&gt;pwd&lt;/script&gt;');
  });

  it('usa el rol crudo cuando no está en el mapa de labels', async () => {
    await notifyUsuarioCreado({
      email: 'creado2@test.co', nombre: 'Creado2', passwordTemporal: 'Temp123!', rol: 'externo',
    });

    const { html } = sendMailSpy.mock.calls[0]?.[0] ?? {};
    expect(html).toContain('externo');
  });
});

describe('notifyRegistroRecibido()', () => {
  it('envía confirmación de solicitud de acceso recibida', async () => {
    await notifyRegistroRecibido({ email: 'nuevo@test.co', nombre: 'Nuevo' });

    const { to, subject, html } = sendMailSpy.mock.calls[0]?.[0] ?? {};
    expect(to).toBe('nuevo@test.co');
    expect(subject).toContain('Solicitud de acceso recibida');
    expect(html).toContain('Nuevo');
  });
});

describe('notifyAdminUsuarioVerificado()', () => {
  it('notifica al admin con el enlace de activación', async () => {
    await notifyAdminUsuarioVerificado({
      adminEmail: 'admin@iiap.gov.co',
      nombre: 'Verificado',
      email: 'verificado@test.co',
      activationUrl: 'https://vigiiap.iiap.gov.co/admin/usuarios/42',
    });

    const { to, html } = sendMailSpy.mock.calls[0]?.[0] ?? {};
    expect(to).toBe('admin@iiap.gov.co');
    expect(html).toContain('verificado@test.co');
    expect(html).toContain('https://vigiiap.iiap.gov.co/admin/usuarios/42');
  });

  it('elimina CRLF del nombre en el subject vía sanitizeSMTP', async () => {
    await notifyAdminUsuarioVerificado({
      adminEmail: 'admin@iiap.gov.co',
      nombre: 'Mal\r\nicioso',
      email: 'malicioso@test.co',
      activationUrl: 'https://vigiiap.iiap.gov.co/admin/usuarios/1',
    });

    const { subject } = sendMailSpy.mock.calls[0]?.[0] ?? {};
    expect(subject).not.toMatch(/\r|\n/);
  });
});

describe('notifySolicitudRespuesta()', () => {
  it('envía la respuesta del administrador escapada en el cuerpo', async () => {
    await notifySolicitudRespuesta({
      email: 'solicitante@test.co',
      nombre: 'Solicitante',
      tipo: 'validacion',
      respuesta: 'Aprobado, <b>revisar anexos</b>',
    });

    const { to, subject, html } = sendMailSpy.mock.calls[0]?.[0] ?? {};
    expect(to).toBe('solicitante@test.co');
    expect(subject).toContain('Validación Cartográfica');
    expect(html).toContain('&lt;b&gt;revisar anexos&lt;/b&gt;');
  });

  it('usa el tipo crudo cuando no está en TIPO_LABEL', async () => {
    await notifySolicitudRespuesta({
      email: 'solicitante@test.co', nombre: 'Solicitante', tipo: 'tipo-raro', respuesta: 'ok',
    });

    const { subject } = sendMailSpy.mock.calls[0]?.[0] ?? {};
    expect(subject).toContain('tipo-raro');
  });
});

describe('notifyRolCambiado()', () => {
  it('notifica al usuario el rol anterior y el nuevo rol', async () => {
    await notifyRolCambiado({
      email: 'usuario@test.co', nombre: 'Usuario', rolAnterior: 'investigador', rolNuevo: 'admin_sig',
    });

    const { to, html } = sendMailSpy.mock.calls[0]?.[0] ?? {};
    expect(to).toBe('usuario@test.co');
    expect(html).toContain('investigador');
    expect(html).toContain('admin_sig');
  });
});

describe('notifyNuevoInicioSesion()', () => {
  it('envía la alerta de seguridad con IP y navegador al propio usuario', async () => {
    await notifyNuevoInicioSesion({
      email: 'usuario@test.co', nombre: 'Usuario',
      ip: '192.168.1.10', userAgent: 'Mozilla/5.0 Test', fecha: '1/9/2026, 9:00:00 a.m.',
    });

    const { to, subject, html } = sendMailSpy.mock.calls[0]?.[0] ?? {};
    expect(to).toBe('usuario@test.co');
    expect(subject).toContain('Nuevo inicio de sesión');
    expect(html).toContain('192.168.1.10');
    expect(html).toContain('Mozilla/5.0 Test');
  });

  it('usa "desconocida"/"desconocido" cuando falta IP o user-agent, sin romper el envío', async () => {
    await notifyNuevoInicioSesion({ email: 'u@test.co', nombre: 'U', fecha: 'hoy' });

    const { html } = sendMailSpy.mock.calls[0]?.[0] ?? {};
    expect(html).toContain('desconocida');
    expect(html).toContain('desconocido');
  });
});

describe('notifyReporteSemanal()', () => {
  it('envía el resumen de actividad al admin con las métricas de la semana', async () => {
    await notifyReporteSemanal({
      adminEmail: 'admin@iiap.gov.co',
      reporte: {
        desde: '2026-08-26', hasta: '2026-09-02',
        usuarios: { nuevos: 3 }, solicitudes: { nuevas: 5, pendientes: 2 },
        documentos: { publicados: 1 }, mapas: { publicados: 0 },
        logins: { exitosos: 20, fallidos: 1 },
      },
    });

    const { to, subject, html } = sendMailSpy.mock.calls[0]?.[0] ?? {};
    expect(to).toBe('admin@iiap.gov.co');
    expect(subject).toContain('2026-08-26');
    expect(html).toContain('20 exitosos / 1 fallidos');
  });
});

describe('notifyErrorCritico()', () => {
  it('alerta al admin con el endpoint y el número de ocurrencias', async () => {
    await notifyErrorCritico({
      adminEmail: 'admin@iiap.gov.co',
      mensaje: 'Connection timeout', metodo: 'POST', ruta: '/api/v1/mapas', ocurrencias: 7,
    });

    const { to, subject, html } = sendMailSpy.mock.calls[0]?.[0] ?? {};
    expect(to).toBe('admin@iiap.gov.co');
    expect(subject).toContain('POST /api/v1/mapas');
    expect(html).toContain('Connection timeout');
    expect(html).toContain('7');
  });
});

// ── notifySolicitudEstado() — labels y colores por defecto ─────────────────────

describe('notifySolicitudEstado() — casos edge de labels', () => {
  it('usa el estado crudo, el color por defecto y el subject "actualizada" para un estado desconocido', async () => {
    await notifySolicitudEstado({
      email: 'u@test.co', nombre: 'U', tipo: 'otro', estado: 'archivada',
    });

    const { subject, html } = sendMailSpy.mock.calls[0]?.[0] ?? {};
    expect(subject).toContain('actualizada');
    expect(html).toContain('archivada');
    expect(html).toContain('#F7AC42');
  });

  it('usa el tipo crudo cuando no está en TIPO_LABEL', async () => {
    await notifySolicitudEstado({
      email: 'u@test.co', nombre: 'U', tipo: 'tipo-desconocido', estado: 'aprobada',
    });

    const { html } = sendMailSpy.mock.calls[0]?.[0] ?? {};
    expect(html).toContain('tipo-desconocido');
  });
});

describe('notifySolicitudRecibida() — tipo desconocido', () => {
  it('usa el tipo crudo en subject y cuerpo cuando no está en TIPO_LABEL', async () => {
    await notifySolicitudRecibida({ email: 'u@test.co', nombre: 'U', tipo: 'tipo-desconocido' });

    const { subject, html } = sendMailSpy.mock.calls[0]?.[0] ?? {};
    expect(subject).toContain('tipo-desconocido');
    expect(html).toContain('tipo-desconocido');
  });
});

// ── send() — manejo de errores de transporte ────────────────────────────────────

describe('send() — errores de transporte SMTP', () => {
  it('no lanza y registra el error cuando sendMail rechaza', async () => {
    sendMailSpy.mockRejectedValueOnce(new Error('SMTP connection timeout'));

    await expect(
      notifySolicitudRecibida({ email: 'u@test.co', nombre: 'U', tipo: 'otro' }),
    ).resolves.toBeUndefined();

    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining('[mailer] Error enviando email a u@test.co:'),
      'SMTP connection timeout',
    );
  });
});

// ── createTransport() — valores por defecto ──────────────────────────────────────

describe('createTransport() — valores por defecto de host/puerto/seguridad', () => {
  it('usa smtp.gmail.com:587 sin TLS cuando MAIL_HOST/MAIL_PORT/MAIL_SECURE no están definidos', async () => {
    delete process.env.MAIL_HOST;
    delete process.env.MAIL_PORT;
    delete process.env.MAIL_SECURE;

    await notifySolicitudRecibida({ email: 'u@test.co', nombre: 'U', tipo: 'otro' });

    expect(nodemailer.createTransport).toHaveBeenCalledWith(
      expect.objectContaining({ host: 'smtp.gmail.com', port: 587, secure: false }),
    );
  });

  it('usa secure:true cuando MAIL_SECURE es "true"', async () => {
    process.env.MAIL_SECURE = 'true';
    process.env.MAIL_PORT = '465';

    await notifySolicitudRecibida({ email: 'u@test.co', nombre: 'U', tipo: 'otro' });

    expect(nodemailer.createTransport).toHaveBeenCalledWith(
      expect.objectContaining({ port: 465, secure: true }),
    );
  });
});

// ── getFromAddress() — ramas de configuración desde BD (módulo aislado) ────────

describe('getFromAddress() — ramas de fallback de BD', () => {
  async function loadMailerFresh() {
    vi.resetModules();
    const dbMod = await import('../src/config/database.js');
    const mailerMod = await import('../src/utils/mailer.js');
    return { query: dbMod.query, mailer: mailerMod };
  }

  it('usa MAIL_USER como dirección cuando mail_remitente no está en BD', async () => {
    delete process.env.MAIL_FROM;
    const { query: freshQuery, mailer } = await loadMailerFresh();
    freshQuery.mockResolvedValue({
      rows: [{ clave: 'mail_remitente_nombre', valor: 'Solo Nombre' }],
    });

    await mailer.notifySolicitudRecibida({ email: 'u@test.co', nombre: 'U', tipo: 'otro' });

    const call = sendMailSpy.mock.calls[0]?.[0];
    expect(call?.from).toContain(process.env.MAIL_USER);
    expect(call?.from).toContain('Solo Nombre');
  });

  it('usa el nombre por defecto "VIGIIAP — IIAP" cuando mail_remitente_nombre no está en BD', async () => {
    delete process.env.MAIL_FROM;
    const { query: freshQuery, mailer } = await loadMailerFresh();
    freshQuery.mockResolvedValue({
      rows: [{ clave: 'mail_remitente', valor: 'solo-addr@iiap.gov.co' }],
    });

    await mailer.notifySolicitudRecibida({ email: 'u@test.co', nombre: 'U', tipo: 'otro' });

    const call = sendMailSpy.mock.calls[0]?.[0];
    expect(call?.from).toContain('solo-addr@iiap.gov.co');
    expect(call?.from).toContain('VIGIIAP');
  });

  it('usa MAIL_FROM_NAME en el fallback de catch cuando está definida', async () => {
    delete process.env.MAIL_FROM;
    process.env.MAIL_FROM_NAME = 'Nombre De Emergencia';
    const { query: freshQuery, mailer } = await loadMailerFresh();
    freshQuery.mockRejectedValue(new Error('DB down'));

    await mailer.notifySolicitudRecibida({ email: 'u@test.co', nombre: 'U', tipo: 'otro' });

    const call = sendMailSpy.mock.calls[0]?.[0];
    expect(call?.from).toContain('Nombre De Emergencia');
    delete process.env.MAIL_FROM_NAME;
  });
});
