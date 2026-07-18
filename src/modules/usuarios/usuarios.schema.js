import { z } from 'zod';

const ROLES = ['admin_sig', 'investigador', 'tecnico', 'institucional', 'publico'];

export const updatePerfilSchema = z.object({
  nombre:      z.string().min(2, 'El nombre debe tener al menos 2 caracteres').max(80).optional(),
  institucion: z.string().max(100).nullable().optional(),
}).refine((d) => d.nombre !== undefined || d.institucion !== undefined, {
  message: 'Debe enviar al menos un campo a actualizar',
});

export const updateRolSchema = z.object({
  rol:    z.enum(ROLES, { errorMap: () => ({ message: `Rol debe ser uno de: ${ROLES.join(', ')}` }) }),
  activo: z.boolean().optional().default(true),
});

import { strongPassword } from '../../utils/passwordPolicy.js';

export const updatePasswordSchema = z.object({
  currentPassword: z.string().min(1, 'Contraseña actual requerida'),
  newPassword:     strongPassword,
});
