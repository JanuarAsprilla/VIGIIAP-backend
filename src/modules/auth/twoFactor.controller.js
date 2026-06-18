import QRCode from 'qrcode';
import jwt from 'jsonwebtoken';
import * as tfService from './twoFactor.service.js';
import * as authService from './auth.service.js';
import {
  COOKIE_NAME, REFRESH_COOKIE_NAME,
  authCookieOptions, refreshCookieOptions,
} from '../../utils/cookieOptions.js';
import { query } from '../../config/database.js';

/** POST /api/auth/2fa/setup — genera secret + QR */
export async function setup(req, res, next) {
  try {
    const { secret, otpauthUrl } = await tfService.setupTotp(req.user.id, req.user.email);
    const qrDataUrl = await QRCode.toDataURL(otpauthUrl);
    res.json({ secret, qrDataUrl });
  } catch (err) { next(err); }
}

/** POST /api/auth/2fa/verify — confirma código y activa 2FA */
export async function verify(req, res, next) {
  try {
    const { code } = req.body;
    if (!code) return res.status(400).json({ error: 'Código TOTP requerido' });
    const { backupCodes } = await tfService.enableTotp(req.user.id, code);
    res.json({ message: '2FA activado. Guarda estos códigos de emergencia en un lugar seguro.', backupCodes });
  } catch (err) { next(err); }
}

/** POST /api/auth/2fa/disable — desactiva 2FA */
export async function disable(req, res, next) {
  try {
    const { code } = req.body;
    if (!code) return res.status(400).json({ error: 'Código TOTP requerido para desactivar' });
    await tfService.disableTotp(req.user.id, code);
    res.json({ message: '2FA desactivado' });
  } catch (err) { next(err); }
}

/** POST /api/auth/2fa/confirm — paso 2 del login cuando 2FA está activo */
export async function confirm(req, res, next) {
  try {
    const rawToken = req.cookies?.['vigiiap_2fa_temp'];
    if (!rawToken) return res.status(401).json({ error: 'Token 2FA no encontrado. Inicia sesión de nuevo.' });

    let payload;
    try {
      payload = jwt.verify(rawToken, process.env.JWT_SECRET, { algorithms: ['HS256'] });
    } catch {
      return res.status(401).json({ error: 'Token 2FA inválido o expirado' });
    }
    if (payload.scope !== '2fa') {
      return res.status(401).json({ error: 'Token incorrecto para este endpoint' });
    }

    const { code } = req.body;
    if (!code) return res.status(400).json({ error: 'Código TOTP requerido' });

    await tfService.verifyTotpOrBackup(payload.id, code);

    const { rows } = await query(
      'SELECT id, nombre, email, rol FROM usuarios WHERE id = $1', [payload.id]
    );
    const user = rows[0];
    const tokens = await authService.issueTokenPair(user, {
      ip: req.ip, userAgent: req.headers['user-agent'],
    });

    res.clearCookie('vigiiap_2fa_temp', { httpOnly: true, secure: true, sameSite: 'None' });
    res.cookie(COOKIE_NAME, tokens.accessToken, authCookieOptions());
    res.cookie(REFRESH_COOKIE_NAME, tokens.refreshToken, refreshCookieOptions());
    res.json({
      token: tokens.accessToken,
      user:  { id: user.id, nombre: user.nombre, email: user.email, rol: user.rol },
    });
  } catch (err) { next(err); }
}
