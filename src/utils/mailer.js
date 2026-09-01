/**
 * VIGIIAP — Servicio de correo electrónico
 * Usa nodemailer con SMTP (Gmail / cualquier proveedor SMTP).
 * Todas las variables de entorno se configuran en .env
 */
import nodemailer from 'nodemailer';
import logger from './logger.js';

/** Elimina caracteres de control CRLF de valores que van en headers SMTP (Subject, To, etc.).
 *  escHtml no es suficiente — escapa HTML pero no elimina \r\n que inyectan headers. */
function sanitizeSMTP(value) {
  // eslint-disable-next-line no-control-regex
  return String(value ?? '').replace(/[\r\n\t\x00-\x08\x0B-\x1F\x7F]/g, ' ').trim().slice(0, 250);
}

function escHtml(value) {
  if (value === null || value === undefined) return '';
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;');
}

// ─── Transporte ───────────────────────────────────────────────────────────────
function createTransport() {
  return nodemailer.createTransport({
    host:   process.env.MAIL_HOST   || 'smtp.gmail.com',
    port:   Number(process.env.MAIL_PORT) || 587,
    secure: process.env.MAIL_SECURE === 'true', // true → 465, false → TLS
    auth: {
      user: process.env.MAIL_USER,
      pass: process.env.MAIL_PASS,
    },
  });
}

// ─── Remitente dinámico — leído de la tabla configuracion con cache de 5 min ──
// El super_admin puede cambiar mail_remitente y mail_remitente_nombre desde el
// panel sin necesidad de redesplegar. MAIL_FROM env var tiene prioridad si existe.
import { query as dbQuery } from '../config/database.js';
let _fromCache = null;
let _fromCacheAt = 0;

async function getFromAddress() {
  if (process.env.MAIL_FROM) return process.env.MAIL_FROM;
  if (_fromCache && Date.now() - _fromCacheAt < 5 * 60_000) return _fromCache;
  try {
    const { rows } = await dbQuery(
      "SELECT clave, valor FROM configuracion WHERE clave IN ('mail_remitente','mail_remitente_nombre')"
    );
    const cfg = Object.fromEntries(rows.map((r) => [r.clave, r.valor]));
    const addr = (cfg.mail_remitente || process.env.MAIL_USER || 'no-reply@iiap.gov.co').replace(/[\r\n]/g, '');
    const name = (cfg.mail_remitente_nombre || 'VIGIIAP — IIAP').replace(/[\r\n"\\]/g, '');
    _fromCache = `"${name}" <${addr}>`;
    _fromCacheAt = Date.now();
  } catch {
    // BD no disponible — usar env var o default sin romper el envío
    const safe = (process.env.MAIL_FROM_NAME || 'VIGIIAP — IIAP').replace(/[\r\n"\\]/g, '');
    _fromCache = `"${safe}" <${process.env.MAIL_USER || 'no-reply@iiap.gov.co'}>`;
    _fromCacheAt = Date.now();
  }
  return _fromCache;
}
const BASE_URL = process.env.FRONTEND_URL || 'https://vigiiap.iiap.gov.co';

const TIPO_LABEL = {
  'uso-suelo':         'Certificado de Uso de Suelo',
  'linderos':          'Consulta de Linderos',
  'estudio-ambiental': 'Estudio Técnico Ambiental',
  'validacion':        'Validación Cartográfica',
  'aprovechamiento':   'Permiso de Aprovechamiento Forestal',
  'otro':              'Otro',
};

// ─── Helper de envío ──────────────────────────────────────────────────────────
async function send({ to, subject, html }) {
  if (!process.env.MAIL_USER || !process.env.MAIL_PASS) {
    logger.warn(`[mailer] MAIL_USER/MAIL_PASS no configurados — email a ${to} omitido`);
    return;
  }
  try {
    const transporter = createTransport();
    const info = await transporter.sendMail({ from: await getFromAddress(), to, subject, html });
    logger.info(`[mailer] Email enviado a ${to} — messageId: ${info.messageId}`);
  } catch (err) {
    // El fallo de email NO debe romper el flujo principal
    logger.error(`[mailer] Error enviando email a ${to}:`, err.message);
  }
}

// ─── Paleta institucional (misma que el frontend — ver src/index.css) ─────────
const GREEN   = '#1A5632';
const GOLD    = '#F7AC42';
const RED     = '#E51A4B';
const INK     = '#1A1A2E';
const BODY    = '#4A5568';
const MUTED   = '#718096';
const BORDER  = '#E2E8F0';
const SURFACE = '#FEFEFE';
const PAGE_BG = '#EDF2F0';

const FONT_SERIF = "'Source Serif 4', Georgia, serif";
const FONT_SANS  = "'Source Sans 3', Arial, sans-serif";

// ─── Plantilla base ───────────────────────────────────────────────────────────
function baseTemplate({ eyebrow, title, body, accent = GOLD, cta }) {
  const ctaBlock = cta ? `
      <tr>
        <td style="padding:32px 40px 12px;">
          <table role="presentation" cellpadding="0" cellspacing="0"><tr>
            <td style="background:${cta.bg ?? GOLD};text-align:center;">
              <a href="${cta.url}" style="display:block;padding:13px 28px;font-size:14px;font-weight:700;color:${cta.textColor ?? INK};text-decoration:none;">${escHtml(cta.label)}</a>
            </td>
          </tr></table>
        </td>
      </tr>` : '';

  return `
<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1.0">
  <title>${escHtml(title)}</title>
</head>
<body style="margin:0;padding:0;background:${PAGE_BG};font-family:${FONT_SANS};">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${PAGE_BG};padding:48px 24px;">
    <tr><td align="center">
      <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="background:${SURFACE};border:1px solid ${BORDER};">

        <tr>
          <td style="background:${GREEN};padding:36px 40px 28px;">
            <table role="presentation" cellpadding="0" cellspacing="0"><tr>
              <td style="padding-right:12px;vertical-align:middle;">
                <svg width="28" height="28" viewBox="0 0 30 30" fill="none">
                  <path d="M15 3C15 3 6 10 6 18C6 23 10 27 15 27C20 27 24 23 24 18C24 10 15 3 15 3Z" stroke="${GOLD}" stroke-width="1.6"/>
                  <path d="M15 8V24" stroke="${GOLD}" stroke-width="1.2" stroke-linecap="round"/>
                  <path d="M15 12L11 15" stroke="${GOLD}" stroke-width="1.2" stroke-linecap="round"/>
                  <path d="M15 17L19 20" stroke="${GOLD}" stroke-width="1.2" stroke-linecap="round"/>
                </svg>
              </td>
              <td style="vertical-align:middle;">
                <span style="font-family:${FONT_SERIF};font-size:19px;color:${SURFACE};letter-spacing:0.02em;">VIGÍA<span style="color:${GOLD};"> · </span>IIAP</span>
              </td>
            </tr></table>
            <p style="margin:6px 0 0 40px;font-size:11px;letter-spacing:0.12em;text-transform:uppercase;color:#8FBBA0;">Instituto de Investigaciones Ambientales del Pacífico</p>
          </td>
        </tr>

        <tr><td style="background:${accent};height:3px;line-height:3px;font-size:0;">&nbsp;</td></tr>

        <tr>
          <td style="padding:44px 40px 8px;">
            ${eyebrow ? `<p style="margin:0 0 10px;font-size:11px;font-weight:700;letter-spacing:0.12em;text-transform:uppercase;color:${accent};">${escHtml(eyebrow)}</p>` : ''}
            <h1 style="margin:0 0 18px;font-family:${FONT_SERIF};font-weight:600;font-size:24px;line-height:1.3;color:${INK};">${escHtml(title)}</h1>
            ${body}
          </td>
        </tr>
        ${ctaBlock}

        <tr>
          <td style="padding:36px 40px 40px;">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-top:1px solid ${BORDER};">
              <tr><td style="padding-top:24px;font-size:12px;line-height:1.7;color:${MUTED};">
                VIGÍA-IIAP · Instituto de Investigaciones Ambientales del Pacífico · Quibdó, Chocó ·
                <a href="${BASE_URL}" style="color:${GREEN};font-weight:600;text-decoration:none;">Ir al portal</a>
              </td></tr>
            </table>
          </td>
        </tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

// Filas etiqueta/valor con línea inferior — reemplaza las cajas de color plano.
function detailRow(label, value) {
  return `
    <tr>
      <td style="padding:16px 0;border-bottom:1px solid ${BORDER};width:120px;font-size:12px;font-weight:700;letter-spacing:0.04em;text-transform:uppercase;color:${MUTED};vertical-align:top;">${escHtml(label)}</td>
      <td style="padding:16px 0;border-bottom:1px solid ${BORDER};font-size:15px;color:${INK};">${value}</td>
    </tr>`;
}

function detailPanel(rows) {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-top:1px solid ${BORDER};margin:8px 0 24px;">${rows.join('')}</table>`;
}

function bodyText(html) {
  return `<p style="margin:0 0 20px;font-size:15px;line-height:1.65;color:${BODY};">${html}</p>`;
}

// ─── Emails específicos ───────────────────────────────────────────────────────

/** Notifica al admin cuando un nuevo usuario se registra */
export async function notifyAdminNewRegistro({ adminEmail, nombre, email, institucion, motivo }) {
  await send({
    to: adminEmail,
    subject: `[VIGI-IIAP] Nuevo registro: ${sanitizeSMTP(nombre)}`,
    html: baseTemplate({
      eyebrow: 'Nuevo registro',
      title: 'Un usuario nuevo se registró en VIGÍA',
      body: bodyText('Requiere revisión antes de quedar activo:') + detailPanel([
        detailRow('Nombre', escHtml(nombre)),
        detailRow('Correo', escHtml(email)),
        detailRow('Institución', escHtml(institucion) || 'No especificada'),
        detailRow('Motivo', escHtml(motivo) || 'No especificado'),
      ]),
      cta: { url: `${BASE_URL}/admin/usuarios`, label: 'Gestionar en el panel' },
    }),
  });
}

/** Notifica al usuario que su cuenta fue activada (o desactivada) */
export async function notifyUsuarioActivacion({ email, nombre, activo, rol }) {
  const estado = activo ? 'activada' : 'desactivada';
  const rolLabel = { admin_sig: 'Administrador SIG', investigador: 'Investigador', publico: 'Público' }[rol] ?? rol;
  await send({
    to: email,
    subject: `[VIGI-IIAP] Cuenta ${sanitizeSMTP(estado)}`,
    html: baseTemplate({
      eyebrow: 'Tu cuenta',
      title: `Tu cuenta ha sido ${estado}`,
      accent: activo ? GOLD : RED,
      body: bodyText(`Hola <strong>${escHtml(nombre)}</strong>, ` + (activo
        ? `tu cuenta en VIGÍA ha sido <strong>activada</strong> con el rol de <strong>${escHtml(rolLabel)}</strong>.`
        : `tu cuenta en VIGÍA ha sido <strong>desactivada</strong>. Si tienes dudas, contacta al administrador.`)),
      cta: activo ? { url: `${BASE_URL}/login`, label: 'Ingresar al portal' } : undefined,
    }),
  });
}

/** Notifica al usuario que su cuenta fue creada por un administrador */
export async function notifyUsuarioCreado({ email, nombre, passwordTemporal, rol }) {
  const rolLabel = { admin_sig: 'Administrador SIG', investigador: 'Investigador', publico: 'Público' }[rol] ?? rol;
  await send({
    to: email,
    subject: '[VIGI-IIAP] Bienvenido — Tu cuenta ha sido creada',
    html: baseTemplate({
      eyebrow: 'Bienvenida',
      title: 'Tu cuenta en VIGÍA está lista',
      body: bodyText(`Hola <strong>${escHtml(nombre)}</strong>, un administrador creó tu cuenta con el rol de <strong>${escHtml(rolLabel)}</strong>. Tus credenciales:`)
        + detailPanel([
          detailRow('Correo', escHtml(email)),
          detailRow('Contraseña temporal', `<code style="background:${PAGE_BG};padding:2px 8px;">${escHtml(passwordTemporal)}</code>`),
        ])
        + bodyText('Por seguridad, cambia tu contraseña después del primer ingreso.'),
      cta: { url: `${BASE_URL}/login`, label: 'Ingresar al portal' },
    }),
  });
}

/** Notifica al usuario el cambio de estado de su solicitud */
export async function notifySolicitudEstado({ email, nombre, tipo, estado, nota }) {
  const estadoLabel = { pendiente: 'Pendiente', en_revision: 'En revisión', aprobada: 'Aprobada', rechazada: 'Rechazada' }[estado] ?? estado;
  const accent = estado === 'aprobada' ? GREEN : estado === 'rechazada' ? RED : GOLD;
  await send({
    to: email,
    subject: `[VIGI-IIAP] Tu solicitud fue ${estado === 'aprobada' ? 'aprobada' : estado === 'rechazada' ? 'rechazada' : 'actualizada'}`,
    html: baseTemplate({
      eyebrow: 'Actualización de solicitud',
      title: `Tu solicitud de "${TIPO_LABEL[tipo] ?? tipo}" — ${estadoLabel}`,
      accent,
      body: bodyText(`Hola <strong>${escHtml(nombre)}</strong>, el estado de tu solicitud cambió.`)
        + detailPanel([
          detailRow('Estado', `<strong style="color:${accent};">${escHtml(estadoLabel)}</strong>`),
          ...(nota ? [detailRow('Nota del administrador', escHtml(nota))] : []),
        ]),
      cta: { url: `${BASE_URL}/solicitudes`, label: 'Ver mis solicitudes' },
    }),
  });
}

/** Envía el email de verificación de correo al registrarse */
export async function notifyVerificacionEmail({ email, nombre, verificationToken }) {
  const verifyUrl = `${BASE_URL}/verificar-email/${encodeURIComponent(verificationToken)}`;
  await send({
    to: email,
    subject: '[VIGI-IIAP] Verifica tu correo electrónico',
    html: baseTemplate({
      eyebrow: 'Un paso más',
      title: 'Verifica tu correo electrónico',
      body: bodyText(`Hola <strong>${escHtml(nombre)}</strong>, gracias por registrarte en VIGÍA. Confirma tu correo para completar tu solicitud de acceso.`)
        + `<p style="margin:20px 0;font-size:12px;color:${MUTED};">Si el botón no funciona, copia este enlace: <br><span style="color:${GREEN};word-break:break-all;">${verifyUrl}</span></p>`
        + `<p style="margin:0;font-size:12px;color:${MUTED};">Este enlace expira en <strong>24 horas</strong>. Si no fuiste tú, ignora este correo.</p>`,
      cta: { url: verifyUrl, label: 'Verificar mi correo', bg: GREEN, textColor: SURFACE },
    }),
  });
}

/** Envía email con enlace para recuperar contraseña */
export async function notifyRecuperarPassword({ email, nombre, resetToken }) {
  const resetUrl = `${BASE_URL}/reset-password/${encodeURIComponent(resetToken)}`;
  await send({
    to: email,
    subject: '[VIGI-IIAP] Recuperación de contraseña',
    html: baseTemplate({
      eyebrow: 'Seguridad de tu cuenta',
      title: 'Recuperar tu contraseña',
      accent: RED,
      body: bodyText(`Hola <strong>${escHtml(nombre)}</strong>, recibimos una solicitud para restablecer tu contraseña.`)
        + `<p style="margin:20px 0;font-size:12px;color:${MUTED};">Si el botón no funciona, copia este enlace: <br><span style="color:${GREEN};word-break:break-all;">${resetUrl}</span></p>`
        + `<p style="margin:0;font-size:12px;color:${MUTED};">Expira en <strong>30 minutos</strong>. Si no fuiste tú, ignora este correo — tu contraseña sigue igual.</p>`,
      cta: { url: resetUrl, label: 'Restablecer contraseña', bg: GREEN, textColor: SURFACE },
    }),
  });
}

/** Notifica al usuario que su solicitud de registro fue recibida */
export async function notifyRegistroRecibido({ email, nombre }) {
  await send({
    to: email,
    subject: '[VIGI-IIAP] Solicitud de acceso recibida',
    html: baseTemplate({
      eyebrow: 'Registro',
      title: 'Recibimos tu solicitud de acceso',
      body: bodyText(`Hola <strong>${escHtml(nombre)}</strong>, un administrador revisará tu información y te avisaremos por correo cuando tu cuenta quede activa.`),
    }),
  });
}

/** Notifica a los admins que un usuario verificó su correo y está listo para ser activado */
export async function notifyAdminUsuarioVerificado({ adminEmail, nombre, email, activationUrl }) {
  await send({
    to: adminEmail,
    subject: `[VIGI-IIAP] Usuario listo para activar: ${sanitizeSMTP(nombre)}`,
    html: baseTemplate({
      eyebrow: 'Pendiente de activación',
      title: 'Un usuario verificó su correo',
      body: bodyText('Está esperando que un administrador active su acceso a VIGÍA:')
        + detailPanel([
          detailRow('Nombre', escHtml(nombre)),
          detailRow('Correo', escHtml(email)),
        ]),
      cta: { url: activationUrl, label: 'Activar usuario en el panel' },
    }),
  });
}

/** Notifica al usuario que su solicitud fue tramitada con respuesta formal del admin */
export async function notifySolicitudRespuesta({ email, nombre, tipo, respuesta }) {
  await send({
    to: email,
    subject: `[VIGI-IIAP] Tu solicitud fue tramitada — ${sanitizeSMTP(TIPO_LABEL[tipo] ?? tipo)}`,
    html: baseTemplate({
      eyebrow: 'Solicitud tramitada',
      title: `Respuesta a tu solicitud de "${TIPO_LABEL[tipo] ?? tipo}"`,
      accent: GREEN,
      body: bodyText(`Hola <strong>${escHtml(nombre)}</strong>, el equipo del IIAP procesó tu solicitud:`)
        + `<div style="border-top:2px solid ${GREEN};padding-top:14px;margin:0 0 24px;">
             <p style="margin:0 0 6px;font-size:11px;font-weight:700;color:${GREEN};text-transform:uppercase;letter-spacing:0.08em;">Respuesta del administrador</p>
             <p style="margin:0;font-size:15px;color:${INK};line-height:1.7;">${escHtml(respuesta)}</p>
           </div>`
        + bodyText('Si tu solicitud incluye archivos o mapas, llegarán por separado a este correo.'),
      cta: { url: `${BASE_URL}/solicitudes`, label: 'Ver mis solicitudes' },
    }),
  });
}

/** Confirma al solicitante que su solicitud fue recibida y está pendiente de revisión */
export async function notifySolicitudRecibida({ email, nombre, tipo }) {
  await send({
    to: email,
    subject: `[VIGI-IIAP] Solicitud recibida — ${TIPO_LABEL[tipo] ?? tipo}`,
    html: baseTemplate({
      eyebrow: 'Solicitud recibida',
      title: `Recibimos tu solicitud de "${TIPO_LABEL[tipo] ?? tipo}"`,
      body: bodyText(`Hola <strong>${escHtml(nombre)}</strong>, el equipo del IIAP la revisará y te notificaremos por este correo sobre el avance.`),
      cta: { url: `${BASE_URL}/solicitudes`, label: 'Ver mis solicitudes' },
    }),
  });
}

/** Notifica nueva solicitud creada al admin */
export async function notifyAdminNuevaSolicitud({ adminEmail, solicitante, email, tipo, descripcion }) {
  await send({
    to: adminEmail,
    subject: `[VIGI-IIAP] Nueva solicitud: ${TIPO_LABEL[tipo] ?? tipo}`,
    html: baseTemplate({
      eyebrow: 'Nueva solicitud recibida',
      title: `Un investigador solicitó "${TIPO_LABEL[tipo] ?? tipo}"`,
      body: bodyText('Está pendiente de tu revisión:') + detailPanel([
        detailRow('Solicitante', escHtml(solicitante)),
        detailRow('Correo', escHtml(email)),
        detailRow('Descripción', escHtml(descripcion)),
      ]),
      cta: { url: `${BASE_URL}/admin/solicitudes`, label: 'Revisar en el panel' },
    }),
  });
}

/** Notifica al usuario que su rol ha sido cambiado por un administrador. */
export async function notifyRolCambiado({ email, nombre, rolAnterior, rolNuevo }) {
  return send({
    to: email,
    subject: `[VIGI-IIAP] Tu rol en el sistema ha sido actualizado`,
    html: baseTemplate({
      eyebrow: 'Cambio de rol',
      title: 'Tu rol en VIGÍA fue actualizado',
      body: bodyText(`Hola <strong>${escHtml(nombre)}</strong>, tu rol en el sistema cambió:`) + detailPanel([
        detailRow('Rol anterior', escHtml(rolAnterior)),
        detailRow('Rol nuevo', `<strong>${escHtml(rolNuevo)}</strong>`),
      ]) + bodyText('Si tienes dudas, contacta al administrador del sistema.'),
    }),
  });
}

/** Alerta de seguridad al propio usuario cuando su cuenta inicia sesión. */
export async function notifyNuevoInicioSesion({ email, nombre, ip, userAgent, fecha }) {
  await send({
    to: email,
    subject: '[VIGI-IIAP] Nuevo inicio de sesión en tu cuenta',
    html: baseTemplate({
      eyebrow: 'Alerta de seguridad',
      title: 'Nuevo inicio de sesión en tu cuenta',
      accent: RED,
      body: bodyText(`Hola <strong>${escHtml(nombre)}</strong>, detectamos un inicio de sesión en tu cuenta de VIGÍA. Si fuiste tú, no necesitas hacer nada.`)
        + detailPanel([
          detailRow('Fecha', escHtml(fecha)),
          detailRow('IP', `<span style="font-family:monospace;">${escHtml(ip || 'desconocida')}</span>`),
          detailRow('Navegador', escHtml(userAgent || 'desconocido')),
        ])
        + bodyText('Si no reconoces esta actividad, cambia tu contraseña de inmediato y contacta a un administrador.'),
      cta: { url: `${BASE_URL}/perfil`, label: 'Cambiar mi contraseña', bg: GREEN, textColor: SURFACE },
    }),
  });
}

/** Alerta de seguridad al propio usuario cuando su cuenta inicia sesión. */
export async function notifyNuevoInicioSesion({ email, nombre, ip, userAgent, fecha }) {
  const eNombre = escHtml(nombre);
  await send({
    to: email,
    subject: '[VIGI-IIAP] Nuevo inicio de sesión en tu cuenta',
    html: baseTemplate('Nuevo inicio de sesión', `
      <p style="color:#374151;font-size:14px;line-height:1.6;">
        Hola <strong>${eNombre}</strong>,
      </p>
      <p style="color:#374151;font-size:14px;line-height:1.6;">
        Detectamos un inicio de sesión en tu cuenta de VIGI-IIAP:
      </p>
      <table style="width:100%;border-collapse:collapse;font-size:13px;margin:16px 0;">
        <tr style="background:#f4f7f4;">
          <td style="padding:8px 12px;font-weight:600;color:#1B4332;width:100px;">Fecha</td>
          <td style="padding:8px 12px;color:#374151;">${escHtml(fecha)}</td>
        </tr>
        <tr>
          <td style="padding:8px 12px;font-weight:600;color:#1B4332;">IP</td>
          <td style="padding:8px 12px;color:#374151;font-family:monospace;">${escHtml(ip || 'desconocida')}</td>
        </tr>
        <tr style="background:#f4f7f4;">
          <td style="padding:8px 12px;font-weight:600;color:#1B4332;">Navegador</td>
          <td style="padding:8px 12px;color:#374151;">${escHtml(userAgent || 'desconocido')}</td>
        </tr>
      </table>
      <p style="color:#6B7280;font-size:12px;">
        Si no fuiste tú, cambia tu contraseña de inmediato y contacta a un administrador.
      </p>
    `),
  });
}
