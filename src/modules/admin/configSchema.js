/**
 * Esquema de configuración del sistema — fuente única compartida entre
 * admin.controller.js (validación + gate de super_admin) y admin.service.js
 * (para saber qué claves disparan la alerta de cambio crítico). Separado en
 * su propio archivo para que ninguno de los dos tenga que importar del otro.
 */

// Claves permitidas para configuración del sistema (ver migración 005_configuracion.sql)
export const CONFIG_SCHEMA = {
  siteName:             { type: 'string', maxLength: 100 },
  siteDesc:             { type: 'string', maxLength: 500 },
  region:               { type: 'string', maxLength: 200 },
  email:                { type: 'string', maxLength: 254 },
  phone:                { type: 'string', maxLength: 50 },
  address:              { type: 'string', maxLength: 300 },
  modoMantenimiento:    { type: 'boolean' },
  mensajeMantenimiento: { type: 'string', maxLength: 1000 },
  // Correo remitente — editable desde el panel del super_admin
  mail_remitente:       { type: 'string', maxLength: 254 },
  mail_remitente_nombre: { type: 'string', maxLength: 100 },
  // SMTP — el instituto cambia de proveedor de correo de vez en cuando; antes
  // requería tocar env vars y redesplegar. mail_pass nunca se devuelve en el
  // GET — solo se escribe, no se relee (ver redactConfig en admin.controller.js).
  mail_host:            { type: 'string', maxLength: 255 },
  mail_port:            { type: 'string', maxLength: 5, pattern: /^\d{1,5}$/ },
  mail_secure:          { type: 'boolean' },
  mail_user:            { type: 'string', maxLength: 254 },
  mail_pass:            { type: 'string', maxLength: 500 },
  // Preferencias de notificaciones y permisos — panel de Configuración
  emailNotifs:           { type: 'boolean' },
  solicitudNotifs:       { type: 'boolean' },
  loginNotifs:           { type: 'boolean' },
  reportesSemanal:       { type: 'boolean' },
  publicoCanSolicitar:   { type: 'boolean' },
  investigadorCanUpload: { type: 'boolean' },
  requireApproval:       { type: 'boolean' },
  // Política de privacidad (Ley 1581 de 2012) y Términos de uso — expuestas
  // públicamente en GET /api/v1/public/configuracion. Campos separados
  // porque son contenido legal distinto, aunque comparten el mismo patrón.
  politicaPrivacidad:    { type: 'string', maxLength: 20000 },
  terminosUso:           { type: 'string', maxLength: 20000 },
  // Operativos — aditivos a sus env vars correspondientes (ver
  // src/config/dynamicConfig.js), nunca los reemplazan. Antes requerían
  // redeploy: agregar un dominio a CORS, ajustar el tope de peticiones, o
  // cambiar el correo de respaldo si no hay admins activos en BD.
  cors_extra_origins:   { type: 'string', maxLength: 1000 },
  rate_limit_max:       { type: 'string', maxLength: 6, pattern: /^\d{1,6}$/ },
  admin_email_fallback: { type: 'string', maxLength: 1000 },
  // Seguridad -- ver src/utils/passwordPolicy.js y RequireAdmin (frontend).
  // passwordExpiryDays ya se leía en auth.service.js#login() desde siempre
  // (default 90), pero nunca estuvo aquí -- solo era editable por SQL directo.
  passwordExpiryDays: { type: 'string', maxLength: 4, pattern: /^\d{1,4}$/ },
  passwordMinLength:  { type: 'string', maxLength: 3, pattern: /^\d{1,3}$/ },
  require2faAdmins:   { type: 'boolean' },
};

// Ajustes rutinarios de contenido (siteName, phone, notifs, etc.) quedan
// disponibles para admin_sig. Estos, no: apagan la plataforma entera, son
// contenido legal/compliance, o son credenciales — el radio de daño de
// cambiarlos mal es demasiado alto para dejarlo fuera del control directo
// del super_admin. También disparan la alerta por correo a todos los
// super_admin activos (ver notifyCambioConfigCritica en admin.service.js).
export const SUPER_ADMIN_ONLY_KEYS = new Set([
  'politicaPrivacidad', 'terminosUso',
  'modoMantenimiento', 'mensajeMantenimiento',
  'mail_host', 'mail_port', 'mail_secure', 'mail_user', 'mail_pass',
  'cors_extra_origins', 'rate_limit_max', 'admin_email_fallback',
  'passwordExpiryDays', 'passwordMinLength', 'require2faAdmins',
]);

// Etiquetas legibles para el correo de alerta — mail_pass nunca debe mostrar
// su valor, solo que cambió.
export const CONFIG_LABELS = {
  politicaPrivacidad:    'Política de privacidad',
  terminosUso:           'Términos de uso',
  modoMantenimiento:     'Modo mantenimiento',
  mensajeMantenimiento:  'Mensaje de mantenimiento',
  mail_host:             'Servidor SMTP (host)',
  mail_port:             'Puerto SMTP',
  mail_secure:           'SMTP seguro (TLS)',
  mail_user:             'Usuario SMTP',
  mail_pass:             'Contraseña SMTP',
  cors_extra_origins:    'Dominios adicionales permitidos (CORS)',
  rate_limit_max:        'Límite de peticiones (rate limit)',
  admin_email_fallback:  'Correo de respaldo para alertas admin',
  passwordExpiryDays:    'Vigencia de contraseña (días)',
  passwordMinLength:     'Longitud mínima de contraseña',
  require2faAdmins:      'Exigir 2FA a administradores',
};
