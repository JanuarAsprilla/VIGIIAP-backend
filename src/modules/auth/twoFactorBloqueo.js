/**
 * Bloqueo por cuenta del segundo factor. El limitador por IP no basta: quien ya conoce la contraseña recibe un
 * token temporal de 15 min y podía probar códigos TOTP de 6 dígitos rotando de IP. Se comparte el contador y la
 * fecha de bloqueo del login (columnas intentos_fallidos / bloqueado_hasta): fallar el código cuenta como fallar
 * la contraseña, y un bloqueo vigente frena ambos caminos.
 */
import { query } from '../../config/database.js';

export const MAX_INTENTOS_2FA = 5;
export const BLOQUEO_2FA_MINUTOS = 15;

const sinAutorizacion = (mensaje, extra = {}) => Object.assign(new Error(mensaje), { status: 401, ...extra });

/** Corta el paso 2 si la cuenta está bloqueada (429) o ya no puede iniciar sesión (401). */
export async function exigirCuentaSinBloqueo(usuarioId) {
  const { rows } = await query('SELECT activo, bloqueado_hasta FROM usuarios WHERE id = $1', [usuarioId]);
  const usuario = rows[0];
  if (!usuario || !usuario.activo) throw sinAutorizacion('Inicia sesión de nuevo.');
  if (usuario.bloqueado_hasta && new Date() < new Date(usuario.bloqueado_hasta)) {
    const minutos = Math.ceil((new Date(usuario.bloqueado_hasta) - new Date()) / 60_000);
    throw Object.assign(
      new Error(`Cuenta bloqueada temporalmente. Intenta de nuevo en ${minutos} minuto(s).`),
      { status: 429, code: 'ACCOUNT_LOCKED' },
    );
  }
}

/** Mismo UPDATE atómico del login: un bloqueo vigente nunca lo limpia un fallo concurrente. */
export async function registrarFalloSegundoFactor(usuarioId) {
  const { rows } = await query(
    `UPDATE usuarios
     SET intentos_fallidos = CASE
           WHEN bloqueado_hasta IS NOT NULL AND bloqueado_hasta > NOW() THEN intentos_fallidos
           WHEN intentos_fallidos + 1 >= $2 THEN 0
           ELSE intentos_fallidos + 1
         END,
         bloqueado_hasta = CASE
           WHEN bloqueado_hasta IS NOT NULL AND bloqueado_hasta > NOW() THEN bloqueado_hasta
           WHEN intentos_fallidos + 1 >= $2 THEN NOW() + ($3 * INTERVAL '1 minute')
           ELSE NULL
         END,
         actualizado_en = NOW()
     WHERE id = $1
     RETURNING intentos_fallidos, bloqueado_hasta`,
    [usuarioId, MAX_INTENTOS_2FA, BLOQUEO_2FA_MINUTOS],
  );
  return { bloqueada: Boolean(rows[0]?.bloqueado_hasta), intentos: rows[0]?.intentos_fallidos ?? 0 };
}

export async function limpiarFallosSegundoFactor(usuarioId) {
  await query(
    `UPDATE usuarios SET intentos_fallidos = 0
     WHERE id = $1 AND (bloqueado_hasta IS NULL OR bloqueado_hasta <= NOW())`,
    [usuarioId],
  );
}
