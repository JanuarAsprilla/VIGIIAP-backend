import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { query } from '../../config/database.js';
import { registrarAuditoria } from '../../utils/auditLog.js';

const SALT_ROUNDS = 12;

function signToken(payload, expiresIn) {
  return jwt.sign(payload, process.env.JWT_SECRET, {
    expiresIn: expiresIn ?? process.env.JWT_EXPIRES_IN ?? '7d',
  });
}

// ─── Login institucional / externo ────────────────────────────────────────────
export async function login(email, password, ip, userAgent) {
  const { rows } = await query(
    'SELECT id, nombre, email, password_hash, rol, activo FROM usuarios WHERE email = $1',
    [email.toLowerCase()]
  );

  const user = rows[0];
  if (!user) throw Object.assign(new Error('Credenciales incorrectas'), { status: 401 });
  if (!user.activo) throw Object.assign(new Error('Cuenta inactiva. Contacta al administrador'), { status: 403 });

  const valid = await bcrypt.compare(password, user.password_hash);
  if (!valid) throw Object.assign(new Error('Credenciales incorrectas'), { status: 401 });

  const token = signToken({ id: user.id, email: user.email, rol: user.rol });

  // Auditoría
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
  // Registra el visitante en la tabla visitantes para trazabilidad
  const { rows } = await query(
    `INSERT INTO visitantes (nombre, tipo, ip, user_agent)
     VALUES ($1, 'externo', $2, $3) RETURNING id`,
    [nombre ?? null, ip ?? null, userAgent ?? null]
  );

  const visitanteId = rows[0].id;

  // Token de corta duración (8h) — no está asociado a un usuario registrado
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
      id:      visitanteId,
      nombre:  nombre ?? 'Visitante',
      email:   null,
      rol:     'visitante',
      tipo:    'visitante',
    },
  };
}

// ─── Registro ─────────────────────────────────────────────────────────────────
export async function register(data) {
  const { nombre, email, password, institucion, motivo, tipoAcceso } = data;

  const exists = await query('SELECT id FROM usuarios WHERE email = $1', [email.toLowerCase()]);
  if (exists.rows.length) {
    throw Object.assign(new Error('El email ya está registrado'), { status: 409 });
  }

  const password_hash = await bcrypt.hash(password, SALT_ROUNDS);

  const { rows } = await query(
    `INSERT INTO usuarios (nombre, email, password_hash, institucion, motivo_acceso, rol, tipo_acceso, activo)
     VALUES ($1, $2, $3, $4, $5, 'publico', $6, false)
     RETURNING id, nombre, email, rol`,
    [nombre, email.toLowerCase(), password_hash, institucion ?? null, motivo, tipoAcceso ?? 'externo']
  );

  return rows[0];
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
