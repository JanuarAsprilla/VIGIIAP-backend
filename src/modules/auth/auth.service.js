import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { query } from '../../config/database.js';
import { registrarAuditoria } from '../../utils/auditLog.js';

const SALT_ROUNDS = 12;

function signToken(payload, expiresIn) {
  return jwt.sign(payload, process.env.JWT_SECRET, {
    expiresIn: expiresIn ?? process.env.JWT_EXPIRES_IN ?? '7d',
  });
}

function generateSecureToken() {
  return crypto.randomBytes(32).toString('hex');
}

const REFRESH_EXPIRES_DAYS = parseInt(process.env.JWT_REFRESH_EXPIRES_DAYS ?? '30', 10);
const ACCESS_EXPIRES        = process.env.JWT_EXPIRES_IN ?? '15m';

// Emite access token (corto) + refresh token (largo), persiste el refresh en BD.
async function issueTokenPair(user, { ip, userAgent } = {}) {
  const accessToken  = signToken({ id: user.id, email: user.email, rol: user.rol }, ACCESS_EXPIRES);
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

// ─── Refresh token — renueva el par con rotación ──────────────────────────────
export async function refreshTokens(rawToken, { ip, userAgent } = {}) {
  const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');

  const { rows } = await query(
    `SELECT rt.id, rt.revocado, rt.expira_en,
            u.id AS uid, u.email, u.rol, u.activo
     FROM refresh_tokens rt
     JOIN usuarios u ON u.id = rt.usuario_id
     WHERE rt.token_hash = $1`,
    [tokenHash]
  );

  const rt = rows[0];
  if (!rt)          throw Object.assign(new Error('Refresh token inválido'), { status: 401 });
  if (rt.revocado)  throw Object.assign(new Error('Refresh token ya fue usado o revocado'), { status: 401 });
  if (new Date() > new Date(rt.expira_en)) {
    throw Object.assign(new Error('Refresh token expirado'), { status: 401 });
  }
  if (!rt.activo)   throw Object.assign(new Error('Cuenta inactiva'), { status: 403 });

  // Revocar el token usado (rotación — un refresh token se usa una sola vez)
  await query('UPDATE refresh_tokens SET revocado = true WHERE id = $1', [rt.id]);

  const user = { id: rt.uid, email: rt.email, rol: rt.rol };
  return issueTokenPair(user, { ip, userAgent });
}

// Revoca todos los refresh tokens activos de un usuario (logout total)
export async function revokeAllRefreshTokens(userId) {
  await query(
    'UPDATE refresh_tokens SET revocado = true WHERE usuario_id = $1 AND revocado = false',
    [userId]
  );
}

// ─── Login institucional / externo ────────────────────────────────────────────
const MAX_INTENTOS = 5;
const LOCKOUT_MINS = 15;

export async function login(email, password, ip, userAgent) {
  const { rows } = await query(
    `SELECT id, nombre, email, password_hash, rol, activo, email_verified,
            intentos_fallidos, bloqueado_hasta
     FROM usuarios WHERE email = $1`,
    [email.toLowerCase()]
  );

  const user = rows[0];
  if (!user) throw Object.assign(new Error('Credenciales incorrectas'), { status: 401 });

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
    const msg = bloquear
      ? `Cuenta bloqueada ${LOCKOUT_MINS} minutos por ${MAX_INTENTOS} intentos fallidos consecutivos.`
      : 'Credenciales incorrectas';
    throw Object.assign(new Error(msg), { status: 401 });
  }

  // Login exitoso — resetear contador de intentos
  if (user.intentos_fallidos > 0 || user.bloqueado_hasta) {
    await query(
      'UPDATE usuarios SET intentos_fallidos = 0, bloqueado_hasta = NULL WHERE id = $1',
      [user.id]
    );
  }

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

  return {
    token: accessToken,
    refreshToken,
    user: { id: user.id, nombre: user.nombre, email: user.email, rol: user.rol },
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

export async function register(data) {
  const { nombre, email, password, institucion, motivo, tipoAcceso, perfil } = data;

  const exists = await query('SELECT id FROM usuarios WHERE email = $1', [email.toLowerCase()]);
  if (exists.rows.length) {
    throw Object.assign(new Error('El email ya está registrado'), { status: 409 });
  }

  const rolInicial = perfilToRol(perfil);
  const password_hash = await bcrypt.hash(password, SALT_ROUNDS);
  const verificationToken = generateSecureToken();
  const verificationExpires = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 horas

  const { rows } = await query(
    `INSERT INTO usuarios
       (nombre, email, password_hash, institucion, motivo_acceso, rol, tipo_acceso, activo,
        email_verified, email_verification_token, email_verification_expires)
     VALUES ($1, $2, $3, $4, $5, $6, $7, false, false, $8, $9)
     RETURNING id, nombre, email, rol`,
    [
      nombre,
      email.toLowerCase(),
      password_hash,
      institucion ?? null,
      motivo ?? null,
      rolInicial,
      tipoAcceso ?? 'externo',
      verificationToken,
      verificationExpires,
    ]
  );

  return { ...rows[0], verificationToken };
}

// ─── Verificar email ──────────────────────────────────────────────────────────
export async function verifyEmail(token) {
  const { rows } = await query(
    `SELECT id, nombre, email, email_verified, email_verification_expires
     FROM usuarios
     WHERE email_verification_token = $1`,
    [token]
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
    [token, expires, rows[0].id]
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
    [resetToken, resetExpires, user.id]
  );

  return { nombre: user.nombre, email: user.email, resetToken };
}

// ─── Resetear contraseña ──────────────────────────────────────────────────────
export async function resetPassword(token, newPassword) {
  const { rows } = await query(
    `SELECT id, email, password_reset_expires
     FROM usuarios
     WHERE password_reset_token = $1`,
    [token]
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
         actualizado_en = NOW()
     WHERE id = $2`,
    [password_hash, user.id]
  );

  return { email: user.email };
}

// ─── Perfil ───────────────────────────────────────────────────────────────────
export async function getProfile(userId) {
  const { rows } = await query(
    'SELECT id, nombre, email, rol, tipo_acceso, institucion, creado_en FROM usuarios WHERE id = $1',
    [userId]
  );
  if (!rows[0]) throw Object.assign(new Error('Usuario no encontrado'), { status: 404 });
  return rows[0];
}
