import { z } from 'zod';

// Acepta booleano nativo o string "true"/"false" (viene de FormData)
const booleanish = z.union([
  z.boolean(),
  z.string().transform((v) => v === 'true'),
]);

const visibilidadEnum = z.enum(['publico', 'usuarios', 'acreditados']).default('publico');

const noticiaBase = z.object({
  titulo:      z.string().min(3, 'Título requerido (mín. 3 caracteres)'),
  categoria:   z.string().optional(),
  resumen:     z.string().optional(),
  contenido:   z.string().optional(),
  imagen_url:  z.string().url('URL de imagen inválida').optional().or(z.literal('')).transform((v) => v || null),
  publicado:   booleanish.optional().default(false),
  visibilidad: visibilidadEnum,
});

export const createNoticiaSchema = noticiaBase;

export const updateNoticiaSchema = noticiaBase.partial().refine(
  (d) => Object.values(d).some((v) => v !== undefined),
  { message: 'Debe enviar al menos un campo a actualizar' },
);
