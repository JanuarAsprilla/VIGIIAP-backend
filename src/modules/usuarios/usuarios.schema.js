import { z } from 'zod';

const ROLES = ['admin_sig', 'investigador', 'publico'];

export const updateRolSchema = z.object({
  rol:    z.enum(ROLES, { errorMap: () => ({ message: `Rol debe ser uno de: ${ROLES.join(', ')}` }) }),
  activo: z.boolean().optional().default(true),
});

const strongPassword = z
  .string()
  .min(8, 'La contraseña debe tener al menos 8 caracteres')
  .refine((v) => /[A-Z]/.test(v), 'Debe incluir al menos una letra mayúscula')
  .refine((v) => /[a-z]/.test(v), 'Debe incluir al menos una letra minúscula')
  .refine((v) => /[\d\W_]/.test(v), 'Debe incluir al menos un número o símbolo');

export const updatePasswordSchema = z.object({
  currentPassword: z.string().min(1, 'Contraseña actual requerida'),
  newPassword:     strongPassword,
});
