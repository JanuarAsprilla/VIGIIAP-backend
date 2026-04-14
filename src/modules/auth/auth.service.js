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

// ─── Login institucional / externo ────────────────────────────────────────────
export async function login(email, password, ip, userAgent) {
  const { rows } = await query(
    'SELECT id, nombre, email, password_hash, rol, activo, email_verified FROM usuarios WHERE email = $1',
    [email.toLowerCase()]
  );

  const user = rows[0];
  if (!user) throw Object.assign(new Error('Credenciales incorrectas'), { status: 401 });

  const valid = await bcrypt.compare(password, user.password_hash);
  if (!valid) throw Object.assign(new Error('Credenciales incorrectas'), { status: 401 });

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

  const token = signToken({ id: user.id, email: user.email, rol: user.rol });

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
    token,
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
  if (['investigador', 'tecnico', 'institucional'].includes(perfil)) return 'investigador';
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
