import { z } from 'zod';

export const loginSchema = z.object({
  email: z.string().email('Email inválido'),
  password: z.string().min(6, 'Contraseña mínimo 6 caracteres'),
});

export const registerSchema = z.object({
  nombre:      z.string().min(2, 'Nombre requerido'),
  email:       z.string().email('Email inválido'),
  password:    z.string().min(8, 'Contraseña mínimo 8 caracteres'),
  institucion: z.string().optional(),
  motivo:      z.string().min(10, 'Describe el motivo de acceso (mín. 10 caracteres)'),
  tipoAcceso:  z.enum(['institucional', 'externo']).optional().default('externo'),
});

export const recoverSchema = z.object({
  email: z.string().email('Email inválido'),
});

export const resetPasswordSchema = z.object({
  token: z.string(),
  password: z.string().min(8, 'Contraseña mínimo 8 caracteres'),
});
