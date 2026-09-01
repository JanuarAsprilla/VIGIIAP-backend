import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { query } from '../../config/database.js';
import { registrarAuditoria } from '../../utils/auditLog.js';
import { notifyNuevoInicioSesion } from '../../utils/mailer.js';
import { notificacionHabilitada } from '../../utils/configFlags.js';
import logger from '../../utils/logger.js';

const SALT_ROUNDS = 12;

function signToken(payload, expiresIn) {
  return jwt.sign(payload, process.env.JWT_SECRET, {
    expiresIn: expiresIn ?? process.env.JWT_EXPIRES_IN ?? '15m',
  });
}

function generateSecureToken() {
  return crypto.randomBytes(32).toString('hex');
}

// Tokens se almacenan como SHA-256 para que una brecha de BD no permita usarlos directamente.
// El valor original solo existe en el email enviado al usuario.
function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

const REFRESH_EXPIRES_DAYS = parseInt(process.env.JWT_REFRESH_EXPIRES_DAYS ?? '30', 10);
const ACCESS_EXPIRES        = process.env.JWT_EXPIRES_IN ?? '15m';

// Emite access token (corto) + refresh token (largo), persiste el refresh en BD.
export async function issueTokenPair(user, { ip, userAgent } = {}) {
  const accessToken  = signToken({ id: user.id, email: user.email, rol: user.rol, scope: 'access' }, ACCESS_EXPIRES);
  const refreshToken = generateSecureToken();
  const tokenHash    = crypto.createHash('sha256').update(refreshToken).digest('hex');
  const expiraEn     = new Date(Date.now() + REFRESH_EXPIRES_DAYS * 86_400_000);

  await query(
    `INSERT INTO refresh_tokens (token_hash, usuario_id, expira_en, ip, user_agent)
     VALUES ($1, $2, $3, $4, $5)`,
    [tokenHash, user.id, expiraEn, ip ?? null, userAgent ?? null]
  );

  return { accessToken, refreshToken };
}

// Ventana de gracia para reuso de un token recién rotado — una segunda petición
// que llega casi al mismo tiempo que la primera (doble clic, reintento de red
// del navegador, dos pestañas abiertas) no es robo, es una carrera benigna del
// mismo cliente legítimo. Solo un reuso mucho después de la rotación es sospechoso.
const REUSE_GRACE_MS = 15_000;

// ─── Refresh token — renueva el par con rotación atómica ─────────────────────
export async function refreshTokens(rawToken, { ip, userAgent } = {}) {
  const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');

  // El UPDATE atómico con WHERE revocado=false y expira_en>NOW() garantiza
  // que solo un proceso puede usar el token — si dos requests llegan al
  // mismo tiempo, solo uno obtiene filas en el RETURNING.
  const { rows } = await query(
    `UPDATE refresh_tokens rt
     SET    revocado = true, revocado_en = NOW()
     FROM   usuarios u
     WHERE  rt.token_hash  = $1
       AND  rt.revocado    = false
       AND  rt.expira_en   > NOW()
       AND  u.id           = rt.usuario_id
       AND  u.activo       = true
     RETURNING rt.id, rt.usuario_id,
               u.id AS uid, u.email, u.rol`,
    [tokenHash]
  );

  if (!rows[0]) {
    // Token inválido/ya-usado puede indicar robo. Buscamos si el token
    // existía pero estaba revocado — si es así, invalidamos
    // TODA la familia de tokens del usuario (evicción total del posible atacante),
    // salvo que la revocación haya ocurrido hace muy poco (ventana de gracia):
    // ahí es casi seguro una carrera del propio cliente, no un atacante.
    const { rows: stolen } = await query(
      `SELECT usuario_id, revocado_en FROM refresh_tokens WHERE token_hash = $1 AND revocado = true`,
      [tokenHash]
    );
    if (stolen[0]) {
      const revocadoHaceMs = stolen[0].revocado_en ? Date.now() - new Date(stolen[0].revocado_en).getTime() : Infinity;
      if (revocadoHaceMs > REUSE_GRACE_MS) {
        await query(
          'UPDATE refresh_tokens SET revocado = true, revocado_en = NOW() WHERE usuario_id = $1 AND revocado = false',
          [stolen[0].usuario_id]
        );
        registrarAuditoria({
          accion:      'refresh_token_reuse',
          modulo:      'auth',
          entidadId:   stolen[0].usuario_id,
          descripcion: 'Refresh token reutilizado fuera de la ventana de gracia — posible robo de token. Sesiones revocadas.',
          ip:          ip ?? null,
          userAgent,
        });
      }
    }
    throw Object.assign(new Error('Refresh token inválido, expirado o ya usado'), { status: 401 });
  }

  const user = { id: rows[0].uid, email: rows[0].email, rol: rows[0].rol };
  return issueTokenPair(user, { ip, userAgent });
}

// Revoca todos los refresh tokens activos de un usuario (logout total)
export async function revokeAllRefreshTokens(userId) {
  await query(
    'UPDATE refresh_tokens SET revocado = true, revocado_en = NOW() WHERE usuario_id = $1 AND revocado = false',
    [userId]
  );
}

// ─── Login institucional / externo ────────────────────────────────────────────
const MAX_INTENTOS = 5;
const LOCKOUT_MINS = 15;

// Hash dummy precalculado — previene timing attack: si el email no existe,
// bcrypt.compare() corre igualmente para que el tiempo de respuesta sea indistinguible.
const DUMMY_HASH = '$2b$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMQJqhN8/LewdBPj0D4U0W5mFS';

export async function login(email, password, ip, userAgent) {
  const { rows } = await query(
    `SELECT id, nombre, email, password_hash, rol, activo, email_verified,
            intentos_fallidos, bloqueado_hasta, password_changed_at, creado_en,
            institucion, tipo_acceso, avatar_url, totp_enabled
     FROM usuarios WHERE email = $1`,
    [email.toLowerCase()]
  );

  const user = rows[0];
  if (!user) {
    // Comparación dummy para igualar tiempo de respuesta con cuentas inexistentes
    await bcrypt.compare(password, DUMMY_HASH);
    throw Object.assign(new Error('Credenciales incorrectas'), { status: 401 });
  }

  // Bloqueo temporal por intentos fallidos
  if (user.bloqueado_hasta && new Date() < new Date(user.bloqueado_hasta)) {
    const minutos = Math.ceil((new Date(user.bloqueado_hasta) - new Date()) / 60_000);
    throw Object.assign(
      new Error(`Cuenta bloqueada temporalmente. Intenta de nuevo en ${minutos} minuto(s).`),
      { status: 429, code: 'ACCOUNT_LOCKED' }
    );
  }

  const valid = await bcrypt.compare(password, user.password_hash);

  if (!valid) {
    const nuevosIntentos = (user.intentos_fallidos ?? 0) + 1;
    const bloquear       = nuevosIntentos >= MAX_INTENTOS;
    await query(
      `UPDATE usuarios
       SET intentos_fallidos = $1,
           bloqueado_hasta   = $2,
           actualizado_en    = NOW()
       WHERE id = $3`,
      [
        bloquear ? 0 : nuevosIntentos,
        bloquear ? new Date(Date.now() + LOCKOUT_MINS * 60_000) : null,
        user.id,
      ]
    );
    registrarAuditoria({
      accion:      bloquear ? 'login_blocked' : 'login_failed',
      modulo:      'auth',
      entidadId:   user.id,
      descripcion: bloquear
        ? `Cuenta bloqueada ${LOCKOUT_MINS}min por ${MAX_INTENTOS} intentos fallidos — ${user.email}`
        : `Login fallido (intento ${nuevosIntentos}/${MAX_INTENTOS}) — ${user.email}`,
      usuarioId:   user.id,
      usuarioEmail: user.email,
      ip,
      userAgent,
    });
    const msg = bloquear
      ? `Cuenta bloqueada ${LOCKOUT_MINS} minutos por ${MAX_INTENTOS} intentos fallidos consecutivos.`
      : 'Credenciales incorrectas';
    throw Object.assign(new Error(msg), { status: 401 });
  }

  // Login exitoso — resetear contador de intentos y registrar último acceso
  await query(
    'UPDATE usuarios SET intentos_fallidos = 0, bloqueado_hasta = NULL, last_login_at = NOW() WHERE id = $1',
    [user.id]
  );

  if (!user.email_verified) {
    throw Object.assign(
      new Error('Debes verificar tu correo electrónico antes de ingresar. Revisa tu bandeja de entrada.'),
      { status: 403, code: 'EMAIL_NOT_VERIFIED' }
    );
  }

  if (!user.activo) {
    throw Object.assign(
      new Error('Tu cuenta está pendiente de aprobación. Recibirás un correo cuando sea activada.'),
      { status: 403, code: 'ACCOUNT_INACTIVE' }
    );
  }

  // Verificar si la contraseña expiró (solo roles institucionales)
  const EXPIRY_ROLES = ['admin_sig', 'investigador', 'tecnico', 'institucional'];
  if (EXPIRY_ROLES.includes(user.rol)) {
    const { rows: cfg } = await query(
      "SELECT valor FROM configuracion WHERE clave = 'passwordExpiryDays'", []
    );
    const expiryDays = parseInt(cfg[0]?.valor ?? '90', 10);
    const changedAt  = user.password_changed_at ?? user.creado_en;
    const expired    = new Date(changedAt) < new Date(Date.now() - expiryDays * 86_400_000);
    if (expired) {
      const expiredJti = generateSecureToken();
      // Almacenar jti en BD para invalidar el token una vez usado (previene replay)
      await query(
        'UPDATE usuarios SET expired_token_jti = $1 WHERE id = $2',
        [expiredJti, user.id]
      );
      const expiredToken = jwt.sign(
        { id: user.id, email: user.email, rol: user.rol, scope: 'password-change', jti: expiredJti },
        process.env.JWT_SECRET,
        { expiresIn: '15m', algorithm: 'HS256' }
      );
      return { passwordExpired: true, expiredToken };
    }
  }

  // Verificar si el usuario tiene 2FA activo
  const { rows: tfRows } = await query(
    'SELECT totp_enabled FROM usuarios WHERE id = $1', [user.id]
  );
  if (tfRows[0]?.totp_enabled) {
    // Emitir token temporal de scope '2fa' válido 15 minutos
    const twoFactorToken = jwt.sign(
      { id: user.id, email: user.email, rol: user.rol, scope: '2fa' },
      process.env.JWT_SECRET,
      { expiresIn: '15m', algorithm: 'HS256' }
    );
    return { requiresTwoFactor: true, twoFactorToken };
  }

  const { accessToken, refreshToken } = await issueTokenPair(
    { id: user.id, email: user.email, rol: user.rol },
    { ip, userAgent }
  );

  registrarAuditoria({
    accion: 'login',
    modulo: 'auth',
    entidadId: user.id,
    descripcion: `Login exitoso — ${user.email}`,
    usuarioId: user.id,
    usuarioEmail: user.email,
    ip,
    userAgent,
  });

  // Alerta de seguridad al propio usuario — apagada por defecto (loginNotifs)
  notificacionHabilitada('loginNotifs').then((habilitado) => {
    if (!habilitado) return;
    notifyNuevoInicioSesion({
      email: user.email, nombre: user.nombre, ip, userAgent,
      fecha: new Date().toLocaleString('es-CO'),
    }).catch((err) => logger.error('[auth] Error email login notif:', err.message));
  }).catch((err) => logger.error('[auth] Error chequeando loginNotifs:', err.message));

  return {
    token: accessToken,
    refreshToken,
    // Mismo shape que /auth/me (getProfile) — el frontend igual pide el perfil
    // completo tras el login vía refreshProfile(), pero se mantiene consistente
    // para no dejar una trampa a otros consumidores (apps móviles, integraciones).
    user: {
      id: user.id, nombre: user.nombre, email: user.email, rol: user.rol,
      institucion: user.institucion, tipo_acceso: user.tipo_acceso,
      avatar_url: user.avatar_url, twoFactorEnabled: user.totp_enabled,
    },
  };
}

// ─── Login visitante (acceso rápido sin credenciales) ─────────────────────────
export async function loginVisitante({ nombre, ip, userAgent }) {
  const { rows } = await query(
    `INSERT INTO visitantes (nombre, tipo, ip, user_agent)
     VALUES ($1, 'externo', $2, $3) RETURNING id`,
    [nombre ?? null, ip ?? null, userAgent ?? null]
  );

  const visitanteId = rows[0].id;

  const token = signToken(
    { visitanteId, rol: 'visitante', tipo: 'visitante' },
    '8h'
  );

  registrarAuditoria({
    accion: 'login_visitante',
    modulo: 'auth',
    entidadId: visitanteId,
    descripcion: `Acceso visitante${nombre ? ` — ${nombre}` : ' — anónimo'}`,
    ip,
    userAgent,
  });

  return {
    token,
    user: {
      id:     visitanteId,
      nombre: nombre ?? 'Visitante',
      email:  null,
      rol:    'visitante',
      tipo:   'visitante',
    },
  };
}

// ─── Registro ─────────────────────────────────────────────────────────────────
// Map perfil solicitado → rol inicial en BD
function perfilToRol(perfil) {
  if (perfil === 'investigador') return 'investigador';
  if (perfil === 'tecnico') return 'tecnico';
  if (perfil === 'institucional') return 'institucional';
  return 'publico';
}

export async function register(data, { ip, userAgent } = {}) {
  const { nombre, email, password, institucion, motivo, tipoAcceso, perfil } = data;

  const exists = await query('SELECT id FROM usuarios WHERE email = $1', [email.toLowerCase()]);
  if (exists.rows.length) {
    throw Object.assign(new Error('El email ya está registrado'), { status: 409 });
  }

  const rolInicial = perfilToRol(perfil);
  const password_hash = await bcrypt.hash(password, SALT_ROUNDS);
  const verificationToken = generateSecureToken();
  const verificationExpires = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 horas

  // configuracion.requireApproval controla si un usuario nuevo queda activo de inmediato
  // o pendiente de aprobación manual. Ausente/'true' (o cualquier valor que no sea el
  // string exacto 'false') → seguro por defecto: requiere aprobación (activo=false),
  // igual que el comportamiento histórico de esta función.
  const { rows: cfg } = await query(
    "SELECT valor FROM configuracion WHERE clave = 'requireApproval'", []
  );
  const activoInicial = cfg[0]?.valor === 'false';

  const { rows } = await query(
    `INSERT INTO usuarios
       (nombre, email, password_hash, institucion, motivo_acceso, rol, tipo_acceso, activo,
        email_verified, email_verification_token, email_verification_expires)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, false, $9, $10)
     RETURNING id, nombre, email, rol`,
    [
      nombre,
      email.toLowerCase(),
      password_hash,
      institucion ?? null,
      motivo ?? null,
      rolInicial,
      tipoAcceso ?? 'externo',
      activoInicial,
      hashToken(verificationToken), // almacenar hash — no el token original
      verificationExpires,
    ]
  );

  registrarAuditoria({
    accion: 'registro',
    modulo: 'auth',
    entidadId: rows[0].id,
    descripcion: `Registro exitoso — ${rows[0].email} (perfil: ${rolInicial})`,
    usuarioId: rows[0].id,
    usuarioEmail: rows[0].email,
    ip,
    userAgent,
  });

  return { ...rows[0], verificationToken }; // devolver token original al llamador para el email
}

// ─── Verificar email ──────────────────────────────────────────────────────────
export async function verifyEmail(token) {
  const { rows } = await query(
    `SELECT id, nombre, email, email_verified, email_verification_expires
     FROM usuarios
     WHERE email_verification_token = $1`,
    [hashToken(token)]
  );

  const user = rows[0];
  if (!user) {
    throw Object.assign(new Error('El enlace de verificación no es válido.'), { status: 400 });
  }
  if (user.email_verified) {
    return { alreadyVerified: true, nombre: user.nombre };
  }
  if (new Date() > new Date(user.email_verification_expires)) {
    throw Object.assign(
      new Error('El enlace de verificación ha expirado. Solicita uno nuevo.'),
      { status: 400, code: 'TOKEN_EXPIRED' }
    );
  }

  await query(
    `UPDATE usuarios
     SET email_verified = true,
         email_verification_token = NULL,
         email_verification_expires = NULL,
         actualizado_en = NOW()
     WHERE id = $1`,
    [user.id]
  );

  return { alreadyVerified: false, nombre: user.nombre, email: user.email };
}

// ─── Reenviar email de verificación ──────────────────────────────────────────
export async function reenviarVerificacion(email) {
  const { rows } = await query(
    'SELECT id, nombre, email, email_verified FROM usuarios WHERE email = $1',
    [email.toLowerCase()]
  );

  // Respuesta genérica para no revelar si el email existe
  if (!rows[0] || rows[0].email_verified) return;

  const token = generateSecureToken();
  const expires = new Date(Date.now() + 24 * 60 * 60 * 1000);

  await query(
    `UPDATE usuarios
     SET email_verification_token = $1,
         email_verification_expires = $2,
         actualizado_en = NOW()
     WHERE id = $3`,
    [hashToken(token), expires, rows[0].id]
  );

  return { nombre: rows[0].nombre, email: rows[0].email, verificationToken: token };
}

// ─── Solicitar recuperación de contraseña ────────────────────────────────────
export async function solicitarRecuperacion(email) {
  const { rows } = await query(
    'SELECT id, nombre, email, email_verified, activo FROM usuarios WHERE email = $1',
    [email.toLowerCase()]
  );

  // Respuesta genérica para no revelar si el email existe
  if (!rows[0]) return null;

  const user = rows[0];
  const resetToken = generateSecureToken();
  const resetExpires = new Date(Date.now() + 30 * 60 * 1000); // 30 minutos

  await query(
    `UPDATE usuarios
     SET password_reset_token = $1,
         password_reset_expires = $2,
         actualizado_en = NOW()
     WHERE id = $3`,
    [hashToken(resetToken), resetExpires, user.id]
  );

  return { nombre: user.nombre, email: user.email, resetToken };
}

// ─── Resetear contraseña ──────────────────────────────────────────────────────
export async function resetPassword(token, newPassword) {
  const { rows } = await query(
    `SELECT id, email, password_reset_expires
     FROM usuarios
     WHERE password_reset_token = $1`,
    [hashToken(token)]
  );

  const user = rows[0];
  if (!user) {
    throw Object.assign(new Error('El enlace de recuperación no es válido.'), { status: 400 });
  }
  if (new Date() > new Date(user.password_reset_expires)) {
    throw Object.assign(
      new Error('El enlace de recuperación ha expirado. Solicita uno nuevo.'),
      { status: 400, code: 'TOKEN_EXPIRED' }
    );
  }

  const password_hash = await bcrypt.hash(newPassword, SALT_ROUNDS);

  await query(
    `UPDATE usuarios
     SET password_hash = $1,
         password_reset_token = NULL,
         password_reset_expires = NULL,
         password_changed_at = NOW(),
         actualizado_en = NOW()
     WHERE id = $2`,
    [password_hash, user.id]
  );

  // Revocar todas las sesiones — quien recupera su cuenta invalida sesiones previas comprometidas
  await revokeAllRefreshTokens(user.id);

  return { email: user.email };
}

// ─── Perfil ───────────────────────────────────────────────────────────────────
export async function getProfile(userId) {
  const { rows } = await query(
    `SELECT id, nombre, email, rol, tipo_acceso, institucion, avatar_url, creado_en, last_login_at,
            totp_enabled AS "twoFactorEnabled"
     FROM usuarios WHERE id = $1`,
    [userId]
  );
  if (!rows[0]) throw Object.assign(new Error('Usuario no encontrado'), { status: 404 });
  return rows[0];
}
