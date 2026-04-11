import { z } from 'zod';

const ROLES = ['admin_sig', 'investigador', 'publico'];

export const updateRolSchema = z.object({
  rol:    z.enum(ROLES, { errorMap: () => ({ message: `Rol debe ser uno de: ${ROLES.join(', ')}` }) }),
  activo: z.boolean().optional().default(true),
});

export const updatePasswordSchema = z.object({
  currentPassword: z.string().min(6, 'Contraseña actual requerida'),
  newPassword:     z.string().min(8, 'Nueva contraseña mínimo 8 caracteres'),
});
