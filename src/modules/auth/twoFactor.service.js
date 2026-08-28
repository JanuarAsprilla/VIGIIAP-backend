/**
 * twoFactor.service.js — lógica de negocio 2FA TOTP
 * Separado del controller para facilitar testing unitario.
 */
import * as OTPAuth from 'otpauth';
import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';
import { query, getClient } from '../../config/database.js';
import { encryptTotpSecret, decryptTotpSecret, isTotpEncryptionEnabled } from '../../utils/totpEncryption.js';

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
  const secret     = new OTPAuth.Secret();
  const secretB32  = secret.base32;
  const totp       = new OTPAuth.TOTP({ issuer: APP_NAME, label: email, secret, period: 30 });
  const otpauthUrl = totp.toString();

  // Cifrar el secret antes de almacenar — si BD es comprometida, el secret no es usable sin la clave AES
  const storedSecret = isTotpEncryptionEnabled() ? encryptTotpSecret(secretB32) : secretB32;
  await query('UPDATE usuarios SET totp_secret = $1 WHERE id = $2', [storedSecret, userId]);
  return { secret: secretB32, otpauthUrl };
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
  const plainSecret = decryptTotpSecret(rows[0].totp_secret);
  if (!checkTotp(code, plainSecret)) {
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

/**
 * Verifica un código TOTP o backup code durante el login. Para TOTP se
 * previene replay guardando el último contador usado (periodo de 30s); los
 * backup codes se consumen de forma atómica con SELECT FOR UPDATE para
 * evitar race conditions.
 */
export async function verifyTotpOrBackup(userId, code) {
  const { rows } = await query(
    'SELECT totp_secret, totp_backup_codes, totp_last_counter FROM usuarios WHERE id = $1', [userId]
  );
  if (!rows[0]) throw Object.assign(new Error('Usuario no encontrado'), { status: 404 });

  // Intentar TOTP primero
  const plainSecret = decryptTotpSecret(rows[0].totp_secret);
  const totpResult = checkTotpWithCounter(code, plainSecret, rows[0].totp_last_counter);
  if (totpResult.valid) {
    // Registrar contador usado para bloquear replay en la misma ventana de 30s
    await query(
      'UPDATE usuarios SET totp_last_counter = $1 WHERE id = $2',
      [totpResult.counter, userId]
    );
    return true;
  }

  // Intentar backup code con SELECT FOR UPDATE para evitar race condition.
  // Verificar primero que hay códigos disponibles — evita abrir transacción en vano.
  const codesSnapshot = rows[0].totp_backup_codes ?? [];
  if (codesSnapshot.length === 0) {
    throw Object.assign(new Error('Código de autenticación inválido'), { status: 401 });
  }

  const client = await getClient();
  try {
    await client.query('BEGIN');
    const { rows: locked } = await client.query(
      'SELECT totp_backup_codes FROM usuarios WHERE id = $1 FOR UPDATE', [userId]
    );
    const codes = locked[0]?.totp_backup_codes ?? [];
    for (let i = 0; i < codes.length; i++) {
      if (await bcrypt.compare(code, codes[i])) {
        await client.query(
          'UPDATE usuarios SET totp_backup_codes = $1 WHERE id = $2',
          [codes.filter((_, idx) => idx !== i), userId]
        );
        await client.query('COMMIT');
        return true;
      }
    }
    await client.query('ROLLBACK');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }

  throw Object.assign(new Error('Código de autenticación inválido'), { status: 401 });
}

/** Desactiva 2FA (requiere código TOTP válido). */
export async function disableTotp(userId, code) {
  const { rows } = await query(
    'SELECT totp_secret FROM usuarios WHERE id = $1 AND totp_enabled = true', [userId]
  );
  if (!rows[0]) throw Object.assign(new Error('2FA no está activado'), { status: 400 });
  const plainSecret = decryptTotpSecret(rows[0].totp_secret);
  if (!checkTotp(code, plainSecret)) {
    throw Object.assign(new Error('Código TOTP inválido'), { status: 401 });
  }
  await query(
    'UPDATE usuarios SET totp_enabled = false, totp_secret = NULL, totp_backup_codes = NULL WHERE id = $1',
    [userId]
  );
}

/** Verifica TOTP y retorna { valid, counter } donde counter es el paso absoluto usado.
 *  counter se persiste en BD para bloquear replay del mismo código en la ventana de 90s.
 */
function checkTotpWithCounter(token, secretB32, lastCounter = null) {
  try {
    const totp  = new OTPAuth.TOTP({ secret: OTPAuth.Secret.fromBase32(secretB32), period: 30 });
    const delta = totp.validate({ token, window: 1 });
    if (delta === null) return { valid: false };
    const currentCounter = Math.floor(Date.now() / 1000 / 30) + delta;
    // Rechazar si el mismo contador ya fue usado (replay en ventana de 90s)
    if (lastCounter !== null && lastCounter !== undefined && currentCounter <= Number(lastCounter)) {
      return { valid: false };
    }
    return { valid: true, counter: currentCounter };
  } catch {
    return { valid: false };
  }
}

/** Verifica TOTP sin tracking de counter (para setup/enable/disable — no son flujos de login). */
function checkTotp(token, secretB32) {
  return checkTotpWithCounter(token, secretB32).valid;
}
