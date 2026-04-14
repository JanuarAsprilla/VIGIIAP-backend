import { z } from 'zod';

export const loginSchema = z.object({
  email: z.string().email('Email inválido'),
  password: z.string().min(6, 'Contraseña mínimo 6 caracteres'),
});

const strongPassword = z
  .string()
  .min(8, 'La contraseña debe tener al menos 8 caracteres')
  .refine((v) => /[A-Z]/.test(v), 'Debe incluir al menos una letra mayúscula')
  .refine((v) => /[a-z]/.test(v), 'Debe incluir al menos una letra minúscula')
  .refine((v) => /[\d\W_]/.test(v), 'Debe incluir al menos un número o símbolo');

export const registerSchema = z.object({
  nombre:      z.string().min(2, 'Nombre requerido'),
  email:       z.string().email('Email inválido'),
  password:    strongPassword,
  institucion: z.string().optional(),
  motivo:      z.string().optional(),
  perfil:      z.enum(['investigador', 'tecnico', 'institucional', 'publico']).optional(),
  tipoAcceso:  z.enum(['institucional', 'externo']).optional().default('externo'),
});

export const recoverSchema = z.object({
  email: z.string().email('Email inválido'),
});

export const resetPasswordSchema = z.object({
  token: z.string(),
  password: z.string().min(8, 'Contraseña mínimo 8 caracteres'),
});
