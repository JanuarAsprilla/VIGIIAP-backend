/**
 * twoFactor.service.js — lógica de negocio 2FA TOTP
 * Separado del controller para facilitar testing unitario.
 */
import { createRequire } from 'module';
const { authenticator } = createRequire(import.meta.url)('otplib');
import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';
import { query } from '../../config/database.js';

const APP_NAME = 'VIGIIAP';

/** Genera un secret TOTP y lo guarda temporalmente (sin activar). */
export async function setupTotp(userId, email) {
  const { rows } = await query(
    'SELECT totp_enabled FROM usuarios WHERE id = $1', [userId]
  );
  if (rows[0]?.totp_enabled) {
    throw Object.assign(
      new Error('2FA ya está activado. Desactívalo primero antes de reconfigurarlo.'),
      { status: 409 }
    );
  }
  const secret     = authenticator.generateSecret();
  const otpauthUrl = authenticator.keyuri(email, APP_NAME, secret);
  await query('UPDATE usuarios SET totp_secret = $1 WHERE id = $2', [secret, userId]);
  return { secret, otpauthUrl };
}

/** Verifica el código TOTP, activa 2FA y devuelve backup codes. */
export async function enableTotp(userId, code) {
  const { rows } = await query(
    'SELECT totp_secret, totp_enabled FROM usuarios WHERE id = $1', [userId]
  );
  if (!rows[0]?.totp_secret) {
    throw Object.assign(new Error('Inicia el setup de 2FA primero'), { status: 400 });
  }
  if (rows[0].totp_enabled) {
    throw Object.assign(new Error('2FA ya está activado'), { status: 409 });
  }
  if (!authenticator.check(code, rows[0].totp_secret)) {
    throw Object.assign(new Error('Código TOTP inválido'), { status: 401 });
  }

  const rawCodes    = Array.from({ length: 8 }, () => crypto.randomBytes(5).toString('hex'));
  const hashedCodes = await Promise.all(rawCodes.map((c) => bcrypt.hash(c, 10)));

  await query(
    'UPDATE usuarios SET totp_enabled = true, totp_backup_codes = $1 WHERE id = $2',
    [hashedCodes, userId]
  );

  return { backupCodes: rawCodes };
}

/** Verifica un código TOTP o backup code durante el login. */
export async function verifyTotpOrBackup(userId, code) {
  const { rows } = await query(
    'SELECT totp_secret, totp_backup_codes FROM usuarios WHERE id = $1', [userId]
  );
  if (!rows[0]) throw Object.assign(new Error('Usuario no encontrado'), { status: 404 });

  if (authenticator.check(code, rows[0].totp_secret)) return true;

  const codes = rows[0].totp_backup_codes ?? [];
  for (let i = 0; i < codes.length; i++) {
    if (await bcrypt.compare(code, codes[i])) {
      await query(
        'UPDATE usuarios SET totp_backup_codes = $1 WHERE id = $2',
        [codes.filter((_, idx) => idx !== i), userId]
      );
      return true;
    }
  }

  throw Object.assign(new Error('Código de autenticación inválido'), { status: 401 });
}

/** Desactiva 2FA (requiere código TOTP válido). */
export async function disableTotp(userId, code) {
  const { rows } = await query(
    'SELECT totp_secret FROM usuarios WHERE id = $1 AND totp_enabled = true', [userId]
  );
  if (!rows[0]) throw Object.assign(new Error('2FA no está activado'), { status: 400 });
  if (!authenticator.check(code, rows[0].totp_secret)) {
    throw Object.assign(new Error('Código TOTP inválido'), { status: 401 });
  }
  await query(
    'UPDATE usuarios SET totp_enabled = false, totp_secret = NULL, totp_backup_codes = NULL WHERE id = $1',
    [userId]
  );
}
