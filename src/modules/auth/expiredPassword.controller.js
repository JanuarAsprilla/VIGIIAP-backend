import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { query } from '../../config/database.js';
import { issueTokenPair, revokeAllRefreshTokens } from './auth.service.js';
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

    const { password } = resetPasswordSchema.pick({ password: true }).parse(req.body);

    const hash = await bcrypt.hash(password, 12);
    await query(
      `UPDATE usuarios
       SET password_hash = $1, password_changed_at = NOW(), actualizado_en = NOW()
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
