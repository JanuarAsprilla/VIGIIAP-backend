/**
 * tokenBlacklist — Revocación de tokens JWT.
 *
 * Estrategia: copia en memoria sincronizada con la BD, así la verificación es O(1) sin consultar
 * la BD en cada petición y la persistencia sobrevive reinicios. Con varias instancias, una
 * revocación atendida por una llega a las demás con la sincronización periódica
 * (sincronizarRevocados), de modo que un cierre de sesión surte efecto en todas en pocos segundos.
 * Cada entrada recuerda cuándo vence el token y se olvida entonces: un JWT vencido ya se rechaza
 * por su firma, no hace falta conservarlo.
 */
import crypto from 'node:crypto';
import { query } from '../config/database.js';
import logger from './logger.js';

const INTERVALO_SINCRONIZACION_MS = 15_000;
// Se piden los revocados de los últimos 2 minutos: cubre varios ciclos perdidos sin releer la tabla entera.
const VENTANA_SINCRONIZACION_SEG = 120;

/** hash del token → instante (ms) en que vence. */
const revocados = new Map();
/** id de usuario → instante (s) anterior al cual sus tokens de acceso ya no valen. */
const cortes = new Map();
// Un token de acceso dura minutos; un día cubre cualquier JWT_EXPIRES_IN razonable y acota la tabla y la memoria.
const RETENCION_CORTES_SEG = 24 * 3600;
let manejador = null;

function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function vencimientoMs(expiresAt) {
  const ms = expiresAt ? new Date(expiresAt).getTime() : NaN;
  return Number.isFinite(ms) ? ms : Infinity;
}

function podarVencidos() {
  const ahora = Date.now();
  for (const [hash, vence] of revocados) {
    if (vence <= ahora) revocados.delete(hash);
  }
  const limiteCorte = Math.floor(ahora / 1000) - RETENCION_CORTES_SEG;
  for (const [usuarioId, corte] of cortes) {
    if (corte < limiteCorte) cortes.delete(usuarioId);
  }
}

/**
 * ¿Un token de acceso emitido antes de que la cuenta cerrara sus sesiones? Los emitidos en el mismo segundo del corte
 * siguen valiendo: así la sesión que nace justo al cambiar la contraseña no se cierra a sí misma (los JWT tienen
 * resolución de segundos). Un token sin `iat`, si hay corte, no se puede fechar y se rechaza.
 */
export function isUserSessionRevoked(payload) {
  if (!payload?.id) return false;
  const corte = cortes.get(payload.id);
  if (corte === undefined) return false;
  return !(payload.iat >= corte);
}

/**
 * Cierra de inmediato los tokens de acceso que la cuenta tenga en circulación (contraseña cambiada o restablecida,
 * cuenta desactivada, cierre de sesión total). Surte efecto aquí al instante y en las demás instancias con la
 * sincronización periódica.
 */
export async function invalidarAccesoDeUsuario(usuarioId) {
  const corte = Math.floor(Date.now() / 1000);
  cortes.set(usuarioId, corte);
  try {
    await query(
      `INSERT INTO sesiones_invalidadas (usuario_id, invalidar_antes_de)
       VALUES ($1, to_timestamp($2))
       ON CONFLICT (usuario_id) DO UPDATE SET invalidar_antes_de = EXCLUDED.invalidar_antes_de`,
      [usuarioId, corte],
    );
  } catch (err) {
    logger.warn(`[tokenBlacklist] Error persistiendo el corte de sesiones: ${err.message}`);
  }
}

function incorporarCortes(rows) {
  rows.forEach((r) => {
    const actual = cortes.get(r.usuario_id) ?? 0;
    if (Number(r.corte) > actual) cortes.set(r.usuario_id, Number(r.corte));
  });
}

/** Retorna true si el token fue revocado explícitamente (logout / invalidación). */
export function isRevoked(token) {
  return revocados.has(hashToken(token));
}

/**
 * Revoca un token: lo añade a memoria y lo persiste en BD.
 * @param {string} token     - JWT raw
 * @param {number} expiresAt - Unix timestamp (segundos) del claim `exp`
 */
export async function revokeToken(token, expiresAt) {
  const hash = hashToken(token);
  revocados.set(hash, expiresAt * 1000);
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
 * Carga la blacklist desde BD a memoria al arrancar el servidor.
 * También purga los tokens ya expirados de la tabla.
 */
export async function loadBlacklist() {
  try {
    await query('DELETE FROM revoked_tokens WHERE expires_at <= NOW()');
    const { rows } = await query(
      'SELECT token_hash, expires_at FROM revoked_tokens WHERE expires_at > NOW()',
    );
    rows.forEach((r) => revocados.set(r.token_hash, vencimientoMs(r.expires_at)));
    await query('DELETE FROM sesiones_invalidadas WHERE invalidar_antes_de < NOW() - make_interval(secs => $1)', [RETENCION_CORTES_SEG]);
    const { rows: filasCortes } = await query(
      'SELECT usuario_id, EXTRACT(EPOCH FROM invalidar_antes_de) AS corte FROM sesiones_invalidadas',
    );
    incorporarCortes(filasCortes);
    logger.info(`[tokenBlacklist] ${rows.length} tokens revocados y ${filasCortes.length} cortes de sesión cargados en memoria`);
  } catch (err) {
    logger.warn(`[tokenBlacklist] Error cargando blacklist (la revocación estará inactiva hasta el próximo arranque): ${err.message}`);
  }
}

/**
 * Incorpora los tokens revocados recientemente por cualquier instancia y olvida los vencidos.
 * Si la BD falla no se pierde nada: se conserva lo que ya estaba en memoria.
 */
export async function sincronizarRevocados() {
  podarVencidos();
  try {
    const { rows } = await query(
      `SELECT token_hash, expires_at FROM revoked_tokens
       WHERE expires_at > NOW() AND revoked_at > NOW() - make_interval(secs => $1)`,
      [VENTANA_SINCRONIZACION_SEG],
    );
    rows.forEach((r) => revocados.set(r.token_hash, vencimientoMs(r.expires_at)));
    const { rows: filasCortes } = await query(
      `SELECT usuario_id, EXTRACT(EPOCH FROM invalidar_antes_de) AS corte FROM sesiones_invalidadas
       WHERE invalidar_antes_de > NOW() - make_interval(secs => $1)`,
      [VENTANA_SINCRONIZACION_SEG],
    );
    incorporarCortes(filasCortes);
  } catch (err) {
    logger.warn(`[tokenBlacklist] No se pudo sincronizar los tokens revocados: ${err.message}`);
  }
}

/** Sincroniza cada 15 s. Llamar una vez al arrancar el servidor, después de loadBlacklist. */
export function startSincronizacionRevocados(intervaloMs = INTERVALO_SINCRONIZACION_MS) {
  stopSincronizacionRevocados();
  manejador = setInterval(sincronizarRevocados, intervaloMs);
  manejador.unref?.();
  return manejador;
}

export function stopSincronizacionRevocados() {
  if (manejador) {
    clearInterval(manejador);
    manejador = null;
  }
}
