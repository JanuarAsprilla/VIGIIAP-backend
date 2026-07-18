import { z } from 'zod';

export const loginSchema = z.object({
  email: z.string().email('Email inválido').max(254),
  // max 72: bcrypt truncates silently beyond 72 bytes; min 8 matches registration policy
  password: z.string().min(8, 'Contraseña mínimo 8 caracteres').max(72, 'Contraseña máximo 72 caracteres'),
});

import { strongPassword } from '../../utils/passwordPolicy.js';

export const registerSchema = z.object({
  nombre:      z.string().min(2, 'Nombre requerido').max(150),
  email:       z.string().email('Email inválido').max(254),
  password:    strongPassword,
  institucion: z.string().max(300).optional(),
  motivo:      z.string().max(500).optional(),
  perfil:      z.enum(['investigador', 'tecnico', 'institucional', 'publico']).optional(),
  tipoAcceso:  z.enum(['institucional', 'externo']).optional().default('externo'),
});

export const recoverSchema = z.object({
  email: z.string().email('Email inválido').max(254),
});

export const resetPasswordSchema = z.object({
  token: z.string(),
  password: strongPassword,
});
