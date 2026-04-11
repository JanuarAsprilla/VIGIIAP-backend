import { z } from 'zod';

const noticiaBase = z.object({
  titulo:     z.string().min(3, 'Título requerido (mín. 3 caracteres)'),
  categoria:  z.string().optional(),
  resumen:    z.string().optional(),
  contenido:  z.string().optional(),
  imagen_url: z.string().url('URL de imagen inválida').optional().or(z.literal('')).transform(v => v || null),
  publicado:  z.boolean().optional().default(false),
});

export const createNoticiaSchema = noticiaBase;

export const updateNoticiaSchema = noticiaBase.partial().extend({
  titulo: z.string().min(3, 'Título requerido (mín. 3 caracteres)'),
});
