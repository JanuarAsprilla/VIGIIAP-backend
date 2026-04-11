import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { query } from '../../config/database.js';

const SALT_ROUNDS = 12;

function signToken(payload) {
  return jwt.sign(payload, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_IN || '7d',
  });
}

export async function login(email, password) {
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

  return {
    token,
    user: { id: user.id, nombre: user.nombre, email: user.email, rol: user.rol },
  };
}

export async function register(data) {
  const { nombre, email, password, institucion, motivo } = data;

  const exists = await query('SELECT id FROM usuarios WHERE email = $1', [email.toLowerCase()]);
  if (exists.rows.length) {
    throw Object.assign(new Error('El email ya está registrado'), { status: 409 });
  }

  const password_hash = await bcrypt.hash(password, SALT_ROUNDS);

  const { rows } = await query(
    `INSERT INTO usuarios (nombre, email, password_hash, institucion, motivo_acceso, rol, activo)
     VALUES ($1, $2, $3, $4, $5, 'publico', false)
     RETURNING id, nombre, email, rol`,
    [nombre, email.toLowerCase(), password_hash, institucion ?? null, motivo]
  );

  return rows[0];
}

export async function getProfile(userId) {
  const { rows } = await query(
    'SELECT id, nombre, email, rol, institucion, creado_en FROM usuarios WHERE id = $1',
    [userId]
  );
  if (!rows[0]) throw Object.assign(new Error('Usuario no encontrado'), { status: 404 });
  return rows[0];
}
