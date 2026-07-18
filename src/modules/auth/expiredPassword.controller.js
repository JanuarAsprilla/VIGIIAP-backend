import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { query } from '../../config/database.js';
import { issueTokenPair, revokeAllRefreshTokens } from './auth.service.js';
import { verifyTotpOrBackup } from './twoFactor.service.js';
import { resetPasswordSchema } from './auth.schema.js';
import {
  COOKIE_NAME, REFRESH_COOKIE_NAME,
  authCookieOptions, refreshCookieOptions,
} from '../../utils/cookieOptions.js';

/** POST /api/auth/change-expired-password */
export async function changeExpiredPassword(req, res, next) {
  try {
    const rawToken = req.cookies?.['vigiiap_expired_temp'];
    if (!rawToken) {
      return res.status(401).json({ error: 'Token de cambio de contraseña no encontrado. Inicia sesión de nuevo.' });
    }

    let payload;
    try {
      payload = jwt.verify(rawToken, process.env.JWT_SECRET, { algorithms: ['HS256'] });
    } catch {
      return res.status(401).json({ error: 'Token inválido o expirado' });
    }
    if (payload.scope !== 'password-change') {
      return res.status(401).json({ error: 'Token incorrecto para este endpoint' });
    }

    // Si el usuario tiene 2FA activo, exigir código TOTP antes de permitir el cambio
    const { rows: tfRow } = await query(
      'SELECT totp_enabled FROM usuarios WHERE id = $1', [payload.id]
    );
    if (tfRow[0]?.totp_enabled) {
      const { totpCode } = req.body;
      if (!totpCode) {
        return res.status(401).json({ error: 'Código TOTP requerido (2FA activo)' });
      }
      await verifyTotpOrBackup(payload.id, totpCode);
    }

    const { password } = resetPasswordSchema.pick({ password: true }).parse(req.body);

    // Verificar que el token no fue ya consumido (previene replay del JWT temporal)
    const { rows: check } = await query(
      'SELECT password_hash, expired_token_jti FROM usuarios WHERE id = $1', [payload.id]
    );
    if (!check[0]) return res.status(401).json({ error: 'Usuario no encontrado' });
    if (payload.jti && check[0].expired_token_jti !== payload.jti) {
      return res.status(401).json({ error: 'Token de cambio ya utilizado. Inicia sesión de nuevo.' });
    }

    // Verificar que la nueva contraseña es diferente a la actual
    const isSame = await bcrypt.compare(password, check[0].password_hash);
    if (isSame) {
      return res.status(400).json({ error: 'La nueva contraseña debe ser diferente a la actual.' });
    }

    const hash = await bcrypt.hash(password, 12);
    await query(
      `UPDATE usuarios
       SET password_hash = $1, password_changed_at = NOW(),
           expired_token_jti = NULL, actualizado_en = NOW()
       WHERE id = $2`,
      [hash, payload.id]
    );
    await revokeAllRefreshTokens(payload.id);

    const { rows } = await query(
      'SELECT id, nombre, email, rol FROM usuarios WHERE id = $1', [payload.id]
    );
    const user   = rows[0];
    const tokens = await issueTokenPair(user, { ip: req.ip, userAgent: req.headers['user-agent'] });

    res.clearCookie('vigiiap_expired_temp', { httpOnly: true, secure: true, sameSite: 'None' });
    res.cookie(COOKIE_NAME, tokens.accessToken, authCookieOptions());
    res.cookie(REFRESH_COOKIE_NAME, tokens.refreshToken, refreshCookieOptions());
    res.json({
      message: 'Contraseña actualizada. Sesión iniciada correctamente.',
      token: tokens.accessToken,
      user: { id: user.id, nombre: user.nombre, email: user.email, rol: user.rol },
    });
  } catch (err) { next(err); }
}
