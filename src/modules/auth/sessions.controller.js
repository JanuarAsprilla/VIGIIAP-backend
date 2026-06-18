import { query } from '../../config/database.js';
import { REFRESH_COOKIE_NAME } from '../../utils/cookieOptions.js';
import crypto from 'node:crypto';

function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

/** GET /api/auth/sessions — lista refresh tokens activos del usuario */
export async function getSessions(req, res, next) {
  try {
    const { rows } = await query(
      `SELECT id, ip, user_agent, creado_en, expira_en, token_hash
       FROM refresh_tokens
       WHERE usuario_id = $1 AND revocado = false AND expira_en > NOW()
       ORDER BY creado_en DESC`,
      [req.user.id]
    );

    const currentRefresh = req.cookies?.[REFRESH_COOKIE_NAME];
    const currentHash    = currentRefresh ? hashToken(currentRefresh) : null;

    const sessions = rows.map(({ token_hash, ...row }) => ({
      id:             row.id,
      ip:             row.ip,
      userAgent:      row.user_agent,
      creadoEn:       row.creado_en,
      expiraEn:       row.expira_en,
      esSesionActual: currentHash ? token_hash === currentHash : false,
    }));

    res.json(sessions);
  } catch (err) { next(err); }
}

/** DELETE /api/auth/sessions/:id — revoca una sesión específica */
export async function revokeSession(req, res, next) {
  try {
    const { rows } = await query(
      `UPDATE refresh_tokens SET revocado = true
       WHERE id = $1 AND usuario_id = $2 AND revocado = false
       RETURNING id`,
      [req.params.id, req.user.id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Sesión no encontrada' });
    res.json({ message: 'Sesión cerrada correctamente' });
  } catch (err) { next(err); }
}

/** DELETE /api/auth/sessions — revoca TODAS las sesiones del usuario */
export async function revokeAllSessions(req, res, next) {
  try {
    await query(
      'UPDATE refresh_tokens SET revocado = true WHERE usuario_id = $1 AND revocado = false',
      [req.user.id]
    );
    res.json({ message: 'Todas las sesiones cerradas correctamente' });
  } catch (err) { next(err); }
}
