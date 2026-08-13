import { z } from 'zod';

/**
 * Política de contraseña unificada para registro, reset y cambio de contraseña.
 * Una sola definición previene inconsistencias entre flujos de autenticación.
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
