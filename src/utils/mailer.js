/**
 * VIGIIAP — Servicio de correo electrónico
 * Usa nodemailer con SMTP (Gmail / cualquier proveedor SMTP).
 * Todas las variables de entorno se configuran en .env
 */
import nodemailer from 'nodemailer';
import logger from './logger.js';

/**
 * Escapa caracteres HTML especiales en cadenas de texto de usuario.
 * Previene XSS cuando datos del usuario se incrustan en plantillas HTML de email.
 * @param {unknown} value
 * @returns {string}
 */
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

const FROM = `"${process.env.MAIL_FROM_NAME || 'VIGI-IIAP'}" <${process.env.MAIL_USER}>`;
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
    const info = await transporter.sendMail({ from: FROM, to, subject, html });
    logger.info(`[mailer] Email enviado a ${to} — messageId: ${info.messageId}`);
  } catch (err) {
    // El fallo de email NO debe romper el flujo principal
    logger.error(`[mailer] Error enviando email a ${to}:`, err.message);
  }
}

// ─── Plantilla base ───────────────────────────────────────────────────────────
function baseTemplate(title, body) {
  return `
<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1.0">
  <title>${title}</title>
</head>
<body style="margin:0;padding:0;background:#f4f7f4;font-family:'Segoe UI',Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f7f4;padding:40px 20px;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.08);">
        <!-- Header -->
        <tr>
          <td style="background:#1B4332;padding:28px 32px;">
            <h1 style="margin:0;color:#D8F3DC;font-size:20px;font-weight:700;letter-spacing:0.5px;">
              🌿 VIGI-IIAP
            </h1>
            <p style="margin:4px 0 0;color:#A8D5B7;font-size:13px;">
              Visor Gestor de Información del Instituto de Investigaciones Ambientales del Pacífico
            </p>
          </td>
        </tr>
        <!-- Body -->
        <tr>
          <td style="padding:32px;">
            <h2 style="margin:0 0 16px;color:#1B4332;font-size:18px;">${title}</h2>
            ${body}
          </td>
        </tr>
        <!-- Footer -->
        <tr>
          <td style="background:#f4f7f4;padding:20px 32px;border-top:1px solid #e8f0e8;">
            <p style="margin:0;color:#6B7280;font-size:12px;text-align:center;">
              Instituto de Investigaciones Ambientales del Pacífico (IIAP) •
              <a href="${BASE_URL}" style="color:#1B4332;text-decoration:none;">Ir al portal</a>
            </p>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

// ─── Emails específicos ───────────────────────────────────────────────────────

/** Notifica al admin cuando un nuevo usuario se registra */
export async function notifyAdminNewRegistro({ adminEmail, nombre, email, institucion, motivo }) {
  const eNombre     = escHtml(nombre);
  const eEmail      = escHtml(email);
  const eInstit     = escHtml(institucion) || 'No especificada';
  const eMotivo     = escHtml(motivo) || 'No especificado';
  await send({
    to: adminEmail,
    subject: `[VIGI-IIAP] Nuevo registro: ${eNombre}`,
    html: baseTemplate('Nuevo registro de usuario', `
      <p style="color:#374151;font-size:14px;line-height:1.6;">
        Un nuevo usuario se ha registrado en VIGI-IIAP y requiere revisión:
      </p>
      <table style="width:100%;border-collapse:collapse;font-size:13px;margin:16px 0;">
        <tr style="background:#f4f7f4;">
          <td style="padding:8px 12px;font-weight:600;color:#1B4332;border-radius:4px;">Nombre</td>
          <td style="padding:8px 12px;color:#374151;">${eNombre}</td>
        </tr>
        <tr>
          <td style="padding:8px 12px;font-weight:600;color:#1B4332;">Email</td>
          <td style="padding:8px 12px;color:#374151;">${eEmail}</td>
        </tr>
        <tr style="background:#f4f7f4;">
          <td style="padding:8px 12px;font-weight:600;color:#1B4332;">Institución</td>
          <td style="padding:8px 12px;color:#374151;">${eInstit}</td>
        </tr>
        <tr>
          <td style="padding:8px 12px;font-weight:600;color:#1B4332;">Motivo</td>
          <td style="padding:8px 12px;color:#374151;">${eMotivo}</td>
        </tr>
      </table>
      <a href="${BASE_URL}/admin/usuarios" style="display:inline-block;background:#1B4332;color:#fff;padding:10px 20px;border-radius:8px;text-decoration:none;font-size:13px;font-weight:600;margin-top:8px;">
        Gestionar usuario en el panel
      </a>
    `),
  });
}

/** Notifica al usuario que su cuenta fue activada (o desactivada) */
export async function notifyUsuarioActivacion({ email, nombre, activo, rol }) {
  const estado = activo ? 'activada' : 'desactivada';
  const rolLabel = { admin_sig: 'Administrador SIG', investigador: 'Investigador', publico: 'Público' }[rol] ?? rol;
  const eNombre   = escHtml(nombre);
  const eRolLabel = escHtml(rolLabel);
  await send({
    to: email,
    subject: `[VIGI-IIAP] Cuenta ${estado}`,
    html: baseTemplate(`Tu cuenta ha sido ${estado}`, `
      <p style="color:#374151;font-size:14px;line-height:1.6;">
        Hola <strong>${eNombre}</strong>,
      </p>
      <p style="color:#374151;font-size:14px;line-height:1.6;">
        ${activo
          ? `Tu cuenta en VIGI-IIAP ha sido <strong>activada</strong>. Ahora puedes ingresar al portal con el rol de <strong>${eRolLabel}</strong>.`
          : `Tu cuenta en VIGI-IIAP ha sido <strong>desactivada</strong>. Si tienes dudas, contacta al administrador.`
        }
      </p>
      ${activo ? `
      <a href="${BASE_URL}/login" style="display:inline-block;background:#1B4332;color:#fff;padding:10px 20px;border-radius:8px;text-decoration:none;font-size:13px;font-weight:600;margin-top:8px;">
        Ingresar al portal
      </a>` : ''}
    `),
  });
}

/** Notifica al usuario que su cuenta fue creada por un administrador */
export async function notifyUsuarioCreado({ email, nombre, passwordTemporal, rol }) {
  const rolLabel  = { admin_sig: 'Administrador SIG', investigador: 'Investigador', publico: 'Público' }[rol] ?? rol;
  const eNombre   = escHtml(nombre);
  const eEmail    = escHtml(email);
  const eRolLabel = escHtml(rolLabel);
  // passwordTemporal es generado por el sistema (crypto.randomBytes) — se escapa igualmente por consistencia
  const ePassword = escHtml(passwordTemporal);
  await send({
    to: email,
    subject: '[VIGI-IIAP] Bienvenido — Tu cuenta ha sido creada',
    html: baseTemplate('Bienvenido a VIGI-IIAP', `
      <p style="color:#374151;font-size:14px;line-height:1.6;">
        Hola <strong>${eNombre}</strong>,
      </p>
      <p style="color:#374151;font-size:14px;line-height:1.6;">
        Un administrador ha creado tu cuenta en VIGI-IIAP con el rol de <strong>${eRolLabel}</strong>.
        Tus credenciales de acceso son:
      </p>
      <div style="background:#f4f7f4;border-left:4px solid #1B4332;padding:14px 18px;border-radius:4px;margin:16px 0;">
        <p style="margin:0;font-size:13px;"><strong>Email:</strong> ${eEmail}</p>
        <p style="margin:6px 0 0;font-size:13px;"><strong>Contraseña temporal:</strong> <code style="background:#e8f0e8;padding:2px 6px;border-radius:4px;">${ePassword}</code></p>
      </div>
      <p style="color:#6B7280;font-size:12px;">
        Por seguridad, te recomendamos cambiar tu contraseña después del primer ingreso.
      </p>
      <a href="${BASE_URL}/login" style="display:inline-block;background:#1B4332;color:#fff;padding:10px 20px;border-radius:8px;text-decoration:none;font-size:13px;font-weight:600;margin-top:8px;">
        Ingresar al portal
      </a>
    `),
  });
}

/** Notifica al usuario el cambio de estado de su solicitud */
export async function notifySolicitudEstado({ email, nombre, tipo, estado, nota }) {
  const estadoLabel = {
    pendiente:   'Pendiente',
    en_revision: 'En revisión',
    aprobada:    '✅ Aprobada',
    rechazada:   '❌ Rechazada',
  }[estado] ?? estado;

  const colorEstado = estado === 'aprobada' ? '#166534' : estado === 'rechazada' ? '#991B1B' : '#1B4332';
  const eNombre     = escHtml(nombre);
  const eTipoLabel  = escHtml(TIPO_LABEL[tipo] ?? tipo);
  const eEstadoLabel= escHtml(estadoLabel);
  const eNota       = nota ? escHtml(nota) : '';

  await send({
    to: email,
    subject: `[VIGI-IIAP] Tu solicitud fue ${estado === 'aprobada' ? 'aprobada' : estado === 'rechazada' ? 'rechazada' : 'actualizada'}`,
    html: baseTemplate('Actualización de solicitud', `
      <p style="color:#374151;font-size:14px;line-height:1.6;">
        Hola <strong>${eNombre}</strong>,
      </p>
      <p style="color:#374151;font-size:14px;line-height:1.6;">
        El estado de tu solicitud de tipo <strong>"${eTipoLabel}"</strong> ha sido actualizado:
      </p>
      <div style="background:#f4f7f4;border-left:4px solid ${colorEstado};padding:14px 18px;border-radius:4px;margin:16px 0;">
        <p style="margin:0;font-size:15px;font-weight:700;color:${colorEstado};">${eEstadoLabel}</p>
        ${eNota ? `<p style="margin:8px 0 0;font-size:13px;color:#374151;"><strong>Nota del administrador:</strong> ${eNota}</p>` : ''}
      </div>
      <a href="${BASE_URL}/solicitudes" style="display:inline-block;background:#1B4332;color:#fff;padding:10px 20px;border-radius:8px;text-decoration:none;font-size:13px;font-weight:600;margin-top:8px;">
        Ver mis solicitudes
      </a>
    `),
  });
}

/** Envía el email de verificación de correo al registrarse */
export async function notifyVerificacionEmail({ email, nombre, verificationToken }) {
  const verifyUrl = `${BASE_URL}/verificar-email/${encodeURIComponent(verificationToken)}`;
  const eNombre   = escHtml(nombre);
  await send({
    to: email,
    subject: '[VIGI-IIAP] Verifica tu correo electrónico',
    html: baseTemplate('Verifica tu correo', `
      <p style="color:#374151;font-size:14px;line-height:1.6;">
        Hola <strong>${eNombre}</strong>,
      </p>
      <p style="color:#374151;font-size:14px;line-height:1.6;">
        Gracias por registrarte en VIGI-IIAP. Para completar tu solicitud de acceso, debes verificar
        tu dirección de correo electrónico haciendo clic en el botón a continuación:
      </p>
      <div style="text-align:center;margin:24px 0;">
        <a href="${verifyUrl}"
           style="display:inline-block;background:#1B4332;color:#fff;padding:13px 28px;border-radius:8px;text-decoration:none;font-size:14px;font-weight:700;">
          Verificar mi correo
        </a>
      </div>
      <div style="background:#f4f7f4;border-left:4px solid #1B4332;padding:12px 16px;border-radius:4px;margin:16px 0;">
        <p style="margin:0;font-size:12px;color:#6B7280;">
          Si el botón no funciona, copia y pega este enlace en tu navegador:
        </p>
        <p style="margin:6px 0 0;font-size:12px;color:#1B4332;word-break:break-all;">${verifyUrl}</p>
      </div>
      <p style="color:#6B7280;font-size:12px;margin-top:16px;">
        Este enlace expira en <strong>24 horas</strong>. Si no te registraste en VIGI-IIAP, ignora este correo.
      </p>
    `),
  });
}

/** Envía email con enlace para recuperar contraseña */
export async function notifyRecuperarPassword({ email, nombre, resetToken }) {
  const resetUrl = `${BASE_URL}/reset-password/${encodeURIComponent(resetToken)}`;
  const eNombre  = escHtml(nombre);
  await send({
    to: email,
    subject: '[VIGI-IIAP] Recuperación de contraseña',
    html: baseTemplate('Recuperar contraseña', `
      <p style="color:#374151;font-size:14px;line-height:1.6;">
        Hola <strong>${eNombre}</strong>,
      </p>
      <p style="color:#374151;font-size:14px;line-height:1.6;">
        Recibimos una solicitud para restablecer la contraseña de tu cuenta en VIGI-IIAP.
        Haz clic en el botón a continuación para crear una nueva contraseña:
      </p>
      <div style="text-align:center;margin:24px 0;">
        <a href="${resetUrl}"
           style="display:inline-block;background:#1B4332;color:#fff;padding:13px 28px;border-radius:8px;text-decoration:none;font-size:14px;font-weight:700;">
          Restablecer contraseña
        </a>
      </div>
      <div style="background:#f4f7f4;border-left:4px solid #1B4332;padding:12px 16px;border-radius:4px;margin:16px 0;">
        <p style="margin:0;font-size:12px;color:#6B7280;">
          Si el botón no funciona, copia y pega este enlace en tu navegador:
        </p>
        <p style="margin:6px 0 0;font-size:12px;color:#1B4332;word-break:break-all;">${resetUrl}</p>
      </div>
      <p style="color:#6B7280;font-size:12px;margin-top:16px;">
        Este enlace expira en <strong>30 minutos</strong>.
        Si no solicitaste este cambio, ignora este correo — tu contraseña no será modificada.
      </p>
    `),
  });
}

/** Notifica al usuario que su solicitud de registro fue recibida */
export async function notifyRegistroRecibido({ email, nombre }) {
  const eNombre = escHtml(nombre);
  await send({
    to: email,
    subject: '[VIGI-IIAP] Solicitud de acceso recibida',
    html: baseTemplate('Solicitud recibida', `
      <p style="color:#374151;font-size:14px;line-height:1.6;">
        Hola <strong>${eNombre}</strong>,
      </p>
      <p style="color:#374151;font-size:14px;line-height:1.6;">
        Hemos recibido tu solicitud de acceso a VIGI-IIAP. Un administrador revisará tu información
        y recibirás un correo cuando tu cuenta sea activada.
      </p>
      <p style="color:#6B7280;font-size:13px;">
        Si tienes preguntas, puedes contactarnos a través del portal.
      </p>
    `),
  });
}

/** Notifica a los admins que un usuario verificó su correo y está listo para ser activado */
export async function notifyAdminUsuarioVerificado({ adminEmail, nombre, email, activationUrl }) {
  const eNombre = escHtml(nombre);
  const eEmail  = escHtml(email);
  await send({
    to: adminEmail,
    subject: `[VIGI-IIAP] ✅ Usuario listo para activar: ${eNombre}`,
    html: baseTemplate('Usuario verificado — pendiente de activación', `
      <div style="background:#ECFDF5;border-left:4px solid #059669;padding:14px 18px;border-radius:4px;margin-bottom:20px;">
        <p style="margin:0;font-size:14px;color:#065F46;font-weight:600;">
          ✅ Un usuario ha verificado su correo electrónico
        </p>
        <p style="margin:6px 0 0;font-size:13px;color:#047857;">
          Su cuenta está pendiente de aprobación y requiere activación manual.
        </p>
      </div>
      <p style="color:#374151;font-size:14px;line-height:1.6;">
        El siguiente usuario completó la verificación de su correo y está esperando que un administrador active su acceso a VIGI-IIAP:
      </p>
      <table style="width:100%;border-collapse:collapse;font-size:13px;margin:16px 0;">
        <tr style="background:#f4f7f4;">
          <td style="padding:10px 14px;font-weight:600;color:#1B4332;width:120px;">Nombre</td>
          <td style="padding:10px 14px;color:#374151;">${eNombre}</td>
        </tr>
        <tr>
          <td style="padding:10px 14px;font-weight:600;color:#1B4332;">Correo</td>
          <td style="padding:10px 14px;color:#374151;">${eEmail}</td>
        </tr>
        <tr style="background:#f4f7f4;">
          <td style="padding:10px 14px;font-weight:600;color:#1B4332;">Estado</td>
          <td style="padding:10px 14px;">
            <span style="background:#FEF3C7;color:#92400E;padding:3px 10px;border-radius:20px;font-size:12px;font-weight:600;">
              Pendiente de activación
            </span>
          </td>
        </tr>
      </table>
      <p style="color:#374151;font-size:13px;line-height:1.6;">
        Haz clic en el botón a continuación para ir al panel de gestión de usuarios y activar la cuenta:
      </p>
      <div style="text-align:center;margin:24px 0;">
        <a href="${activationUrl}"
           style="display:inline-block;background:#1B4332;color:#fff;padding:13px 28px;border-radius:8px;text-decoration:none;font-size:14px;font-weight:700;">
          Activar usuario en el panel
        </a>
      </div>
      <p style="color:#9CA3AF;font-size:11px;text-align:center;margin-top:16px;">
        Si no puedes hacer clic en el botón, visita: <br>
        <a href="${activationUrl}" style="color:#1B4332;">${activationUrl}</a>
      </p>
    `),
  });
}

/** Notifica al usuario que su solicitud fue tramitada con respuesta formal del admin */
export async function notifySolicitudRespuesta({ email, nombre, tipo, respuesta }) {
  const eNombre    = escHtml(nombre);
  const eTipoLabel = escHtml(TIPO_LABEL[tipo] ?? tipo);
  const eRespuesta = escHtml(respuesta);
  await send({
    to: email,
    subject: `[VIGI-IIAP] Tu solicitud fue tramitada — ${eTipoLabel}`,
    html: baseTemplate('Tu solicitud ha sido tramitada', `
      <p style="color:#374151;font-size:14px;line-height:1.6;">
        Hola <strong>${eNombre}</strong>,
      </p>
      <p style="color:#374151;font-size:14px;line-height:1.6;">
        El equipo del IIAP ha procesado tu solicitud de tipo
        <strong>"${eTipoLabel}"</strong> y te envía la siguiente respuesta:
      </p>
      <div style="background:#ECFDF5;border-left:4px solid #059669;padding:16px 20px;border-radius:6px;margin:20px 0;">
        <p style="margin:0 0 6px;font-size:11px;font-weight:700;color:#065F46;text-transform:uppercase;letter-spacing:0.08em;">
          Respuesta del administrador
        </p>
        <p style="margin:0;font-size:14px;color:#1F2937;line-height:1.7;">${eRespuesta}</p>
      </div>
      <div style="background:#FFF7ED;border-left:4px solid #D4A373;padding:12px 16px;border-radius:6px;margin:16px 0;">
        <p style="margin:0;font-size:13px;color:#92400E;line-height:1.6;">
          <strong>Nota:</strong> Si tu solicitud incluye archivos, mapas u otros documentos,
          serán enviados por separado a este correo electrónico.
          También puedes revisar el estado de tu solicitud directamente en el portal VIGI-IIAP.
        </p>
      </div>
      <div style="text-align:center;margin:28px 0 16px;">
        <a href="${BASE_URL}/solicitudes"
           style="display:inline-block;background:#1B4332;color:#fff;padding:12px 28px;border-radius:8px;text-decoration:none;font-size:13px;font-weight:700;">
          Ver mis solicitudes en el portal
        </a>
      </div>
    `),
  });
}

/** Notifica nueva solicitud creada al admin */
export async function notifyAdminNuevaSolicitud({ adminEmail, solicitante, email, tipo, descripcion }) {
  const eSolicitante  = escHtml(solicitante);
  const eEmail        = escHtml(email);
  const eTipoLabel    = escHtml(TIPO_LABEL[tipo] ?? tipo);
  const eDescripcion  = escHtml(descripcion);
  await send({
    to: adminEmail,
    subject: `[VIGI-IIAP] Nueva solicitud: ${TIPO_LABEL[tipo] ?? tipo}`,
    html: baseTemplate('Nueva solicitud recibida', `
      <p style="color:#374151;font-size:14px;line-height:1.6;">
        Se ha recibido una nueva solicitud en VIGI-IIAP:
      </p>
      <table style="width:100%;border-collapse:collapse;font-size:13px;margin:16px 0;">
        <tr style="background:#f4f7f4;">
          <td style="padding:8px 12px;font-weight:600;color:#1B4332;">Solicitante</td>
          <td style="padding:8px 12px;color:#374151;">${eSolicitante}</td>
        </tr>
        <tr>
          <td style="padding:8px 12px;font-weight:600;color:#1B4332;">Email</td>
          <td style="padding:8px 12px;color:#374151;">${eEmail}</td>
        </tr>
        <tr style="background:#f4f7f4;">
          <td style="padding:8px 12px;font-weight:600;color:#1B4332;">Tipo</td>
          <td style="padding:8px 12px;color:#374151;">${eTipoLabel}</td>
        </tr>
        <tr>
          <td style="padding:8px 12px;font-weight:600;color:#1B4332;">Descripción</td>
          <td style="padding:8px 12px;color:#374151;">${eDescripcion}</td>
        </tr>
      </table>
      <a href="${BASE_URL}/admin/solicitudes" style="display:inline-block;background:#1B4332;color:#fff;padding:10px 20px;border-radius:8px;text-decoration:none;font-size:13px;font-weight:600;margin-top:8px;">
        Gestionar en el panel
      </a>
    `),
  });
}
