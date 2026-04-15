import { z } from 'zod';

export const createDocumentoSchema = z.object({
  titulo:      z.string().min(3, 'Título requerido (mín. 3 caracteres)'),
  tipo:        z.string().min(2, 'Tipo requerido (informe, articulo, libro, tesis…)'),
  anio:        z.coerce.number().int().min(1900).max(2100).optional(),
  autores:     z.string().optional(),
  resumen:     z.string().optional(),
  // archivo_url puede venir de R2 (inyectado por upload middleware) o enviarse directo
  archivo_url: z.string().url('URL de archivo inválida').optional(),
});

export const updateDocumentoSchema = z.object({
  titulo:      z.string().min(3, 'Título requerido (mín. 3 caracteres)').optional(),
  tipo:        z.string().min(2).optional(),
  anio:        z.coerce.number().int().min(1900).max(2100).nullable().optional(),
  autores:     z.string().optional(),
  resumen:     z.string().optional(),
  archivo_url: z.string().url('URL de archivo inválida').optional(),
}).refine(
  (d) => Object.values(d).some((v) => v !== undefined),
  { message: 'Debe enviar al menos un campo a actualizar' },
);
