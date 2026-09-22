import { z } from 'zod';
import { getPasswordMinLength } from '../config/dynamicConfig.js';

/**
 * Política de contraseña unificada para registro, reset y cambio de contraseña.
 * Una sola definición previene inconsistencias entre flujos de autenticación.
 *
 * El mínimo de 8 caracteres queda fijo aquí a propósito -- es el piso de
 * seguridad no negociable. Lo que sí es configurable desde el panel
 * (super_admin) es exigir MÁS que eso; ver validarLongitudMinima() abajo,
 * que se llama aparte porque Zod valida de forma síncrona y la longitud
 * configurada vive en BD (con cache, ver dynamicConfig.js).
 */
export const strongPassword = z
  .string()
  .min(8, 'Contraseña mínimo 8 caracteres')
  .max(72, 'Contraseña máximo 72 caracteres (límite bcrypt)')
  .refine((v) => /[A-Z]/.test(v), 'Debe incluir al menos una letra mayúscula')
  .refine((v) => /[a-z]/.test(v), 'Debe incluir al menos una letra minúscula')
  .refine((v) => /[0-9]/.test(v), 'Debe incluir al menos un número')
  .refine(
    (v) => /[!@#$%^&*()\-_=+[\]{};:'",.<>/?`~|]/.test(v),
    'Debe incluir al menos un carácter especial (!@#$%^&* etc.)',
  );

/**
 * Chequeo adicional contra la longitud mínima configurada por el
 * super_admin (si es mayor que el piso de 8 que ya exige strongPassword).
 * Llamar DESPUÉS de que el schema con strongPassword ya validó el resto.
 */
export async function validarLongitudMinima(password) {
  const minimo = await getPasswordMinLength();
  if (password.length < minimo) {
    throw Object.assign(
      new Error(`Contraseña mínimo ${minimo} caracteres`),
      { status: 422 },
    );
  }
}
