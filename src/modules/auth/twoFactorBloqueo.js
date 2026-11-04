/**
 * Bloqueo por cuenta del segundo factor. El limitador por IP no basta: quien ya conoce la contraseña recibe un
 * token temporal de 15 min y podía probar códigos TOTP de 6 dígitos rotando de IP. Se comparte el contador y la
 * fecha de bloqueo del login (columnas intentos_fallidos / bloqueado_hasta).
 *
 * El intento se RESERVA antes de verificar el código, con una fila bloqueada (FOR UPDATE): una ráfaga en
 * paralelo no puede comprobar «¿hay bloqueo?» todas a la vez y probar cientos de códigos; solo las primeras
 * MAX_INTENTOS_2FA llegan a verificarse. El login con contraseña no reinicia este contador cuando la cuenta
 * tiene 2FA (auth.service.js): solo lo limpia un código correcto.
 */
import { query } from '../../config/database.js';

export const MAX_INTENTOS_2FA = 5;
export const BLOQUEO_2FA_MINUTOS = 15;

/**
 * Reserva un intento. Lanza 401 si la cuenta no existe o está desactivada y 429 si ya estaba bloqueada.
 * Devuelve `{ bloqueaAhora }`: true cuando ESTE intento agotó el cupo (se verifica igual, pero si falla se
 * informa del bloqueo).
 */
export async function reservarIntentoSegundoFactor(usuarioId) {
  const { rows } = await query(
    `WITH previo AS (
       SELECT id, (bloqueado_hasta IS NOT NULL AND bloqueado_hasta > NOW()) AS estaba_bloqueada
       FROM usuarios WHERE id = $1 AND activo FOR UPDATE
     )
     UPDATE usuarios u
     SET intentos_fallidos = CASE
           WHEN p.estaba_bloqueada THEN u.intentos_fallidos
           WHEN u.intentos_fallidos + 1 >= $2 THEN 0
           ELSE u.intentos_fallidos + 1
         END,
         bloqueado_hasta = CASE
           WHEN p.estaba_bloqueada THEN u.bloqueado_hasta
           WHEN u.intentos_fallidos + 1 >= $2 THEN NOW() + ($3 * INTERVAL '1 minute')
           ELSE NULL
         END,
         actualizado_en = NOW()
     FROM previo p
     WHERE u.id = p.id
     RETURNING p.estaba_bloqueada, u.bloqueado_hasta`,
    [usuarioId, MAX_INTENTOS_2FA, BLOQUEO_2FA_MINUTOS],
  );
  const fila = rows[0];
  if (!fila) throw Object.assign(new Error('Inicia sesión de nuevo.'), { status: 401 });
  if (fila.estaba_bloqueada) {
    const minutos = Math.max(1, Math.ceil((new Date(fila.bloqueado_hasta) - new Date()) / 60_000));
    throw Object.assign(
      new Error(`Cuenta bloqueada temporalmente. Intenta de nuevo en ${minutos} minuto(s).`),
      { status: 429, code: 'ACCOUNT_LOCKED' },
    );
  }
  return { bloqueaAhora: Boolean(fila.bloqueado_hasta) };
}

/** Código correcto: se limpia el contador y el bloqueo que este mismo intento pudo haber fijado. */
export async function limpiarFallosSegundoFactor(usuarioId) {
  await query('UPDATE usuarios SET intentos_fallidos = 0, bloqueado_hasta = NULL WHERE id = $1', [usuarioId]);
}
