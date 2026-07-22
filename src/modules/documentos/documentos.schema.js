import { z } from 'zod';

const CURRENT_YEAR = new Date().getFullYear();

// Validar que archivo_url pertenezca al dominio R2 propio — previene que un admin_sig
// comprometido apunte documentos a URLs maliciosas externas eludiendo fileGuard.
const r2Url = z.string().url().refine(
  (url) => {
    const publicUrl  = process.env.R2_PUBLIC_URL ?? '';
    const privateUrl = process.env.R2_PUBLIC_BUCKET_URL ?? '';
    return url.startsWith(publicUrl) || url.startsWith(privateUrl);
  },
  { message: 'archivo_url debe ser una URL del almacenamiento propio (R2)' },
).optional();

const visibilidadEnum = z.enum(['publico', 'usuarios', 'acreditados']).default('publico');

export const createDocumentoSchema = z.object({
  titulo:      z.string().min(3, 'Título requerido (mín. 3 caracteres)'),
  tipo:        z.string().min(2, 'Tipo requerido'),
  anio:        z.coerce.number().int().min(1900).max(2100).optional(),
  autores:     z.string().optional(),
  resumen:     z.string().optional(),
  archivo_url:          r2Url,
  archivo_tamano_bytes: z.coerce.number().int().optional(),
  visibilidad:          visibilidadEnum,
});

export const updateDocumentoSchema = z.object({
  titulo:               z.string().min(3, 'Título requerido (mín. 3 caracteres)').optional(),
  tipo:                 z.string().min(2).optional(),
  anio:                 z.coerce.number().int().min(1900).max(CURRENT_YEAR + 1).nullable().optional(),
  autores:              z.string().optional(),
  resumen:              z.string().optional(),
  archivo_url:          r2Url,
  archivo_tamano_bytes: z.coerce.number().int().optional(),
  visibilidad:          z.enum(['publico', 'usuarios', 'acreditados']).optional(),
}).refine(
  (d) => Object.values(d).some((v) => v !== undefined),
  { message: 'Debe enviar al menos un campo a actualizar' },
);

export const toggleDocumentoSchema = z.object({ activo: z.coerce.boolean() });
