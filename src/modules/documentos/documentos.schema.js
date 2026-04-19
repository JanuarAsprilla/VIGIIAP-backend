import { z } from 'zod';

const visibilidadEnum = z.enum(['publico', 'usuarios', 'acreditados']).default('publico');

export const createDocumentoSchema = z.object({
  titulo:      z.string().min(3, 'Título requerido (mín. 3 caracteres)'),
  tipo:        z.string().min(2, 'Tipo requerido'),
  anio:        z.coerce.number().int().min(1900).max(2100).optional(),
  autores:     z.string().optional(),
  resumen:     z.string().optional(),
  archivo_url: z.string().url('URL de archivo inválida').optional(),
  visibilidad: visibilidadEnum,
});

export const updateDocumentoSchema = z.object({
  titulo:      z.string().min(3, 'Título requerido (mín. 3 caracteres)').optional(),
  tipo:        z.string().min(2).optional(),
  anio:        z.coerce.number().int().min(1900).max(2100).nullable().optional(),
  autores:     z.string().optional(),
  resumen:     z.string().optional(),
  archivo_url: z.string().url('URL de archivo inválida').optional(),
  visibilidad: z.enum(['publico', 'usuarios', 'acreditados']).optional(),
}).refine(
  (d) => Object.values(d).some((v) => v !== undefined),
  { message: 'Debe enviar al menos un campo a actualizar' },
);
