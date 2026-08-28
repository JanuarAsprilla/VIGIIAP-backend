/**
 * tokenBlacklist — Revocación de tokens JWT.
 *
 * Estrategia: in-memory Set sincronizado con BD al arrancar, así la
 * verificación es O(1) sin hit de BD por cada request, la persistencia en
 * BD sobrevive reinicios, y los tokens expirados se purgan de BD en cada
 * loadBlacklist().
 */
import crypto from 'node:crypto';
import { query } from '../config/database.js';
import logger from './logger.js';

const revokedSet = new Set();

function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

/** Retorna true si el token fue revocado explícitamente (logout / invalidación). */
export function isRevoked(token) {
  return revokedSet.has(hashToken(token));
}

/**
 * Revoca un token: lo añade a memoria y lo persiste en BD.
 * @param {string} token     - JWT raw
 * @param {number} expiresAt - Unix timestamp (segundos) del claim `exp`
 */
export async function revokeToken(token, expiresAt) {
  const hash = hashToken(token);
  revokedSet.add(hash);
  try {
    await query(
      `INSERT INTO revoked_tokens (token_hash, expires_at)
       VALUES ($1, $2)
       ON CONFLICT (token_hash) DO NOTHING`,
      [hash, new Date(expiresAt * 1000)],
    );
  } catch (err) {
    logger.warn(`[tokenBlacklist] Error persistiendo token revocado: ${err.message}`);
  }
}

/**
 * Carga la blacklist desde BD al memoria al arrancar el servidor.
 * También purga los tokens ya expirados de la tabla.
 */
export async function loadBlacklist() {
  try {
    await query('DELETE FROM revoked_tokens WHERE expires_at <= NOW()');
    const { rows } = await query(
      'SELECT token_hash FROM revoked_tokens WHERE expires_at > NOW()',
    );
    rows.forEach((r) => revokedSet.add(r.token_hash));
    logger.info(`[tokenBlacklist] ${rows.length} tokens revocados cargados en memoria`);
  } catch (err) {
    logger.warn(`[tokenBlacklist] Error cargando blacklist (la revocación estará inactiva hasta el próximo arranque): ${err.message}`);
  }
}
