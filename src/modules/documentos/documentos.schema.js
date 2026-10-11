import { z } from 'zod';

const CURRENT_YEAR = new Date().getFullYear();

// Validar que archivo_url pertenezca al dominio R2 propio — previene que un admin_sig
// comprometido apunte documentos a URLs maliciosas externas eludiendo fileGuard.
const r2Url = z.string().url().refine(
  (url) => {
    const publicUrl  = process.env.R2_PUBLIC_URL;
    const privateUrl = process.env.R2_PUBLIC_BUCKET_URL;
    // Si una de las variables no está configurada, no debe actuar como comodín
    // (startsWith('') es true para cualquier string) — solo compara contra valores reales.
    return (!!publicUrl && url.startsWith(publicUrl)) || (!!privateUrl && url.startsWith(privateUrl));
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

// REGRESIÓN (hallazgo de auditoría dinámica con ZAP): a diferencia de los
// esquemas de arriba, GET / nunca validaba req.query -- un anio no numérico
// llegaba crudo hasta `d.anio = $N` contra una columna smallint y Postgres
// tiraba un 500 con su propio mensaje de error (expone el motor de BD y el
// tipo de columna en cualquier entorno que no sea NODE_ENV=production).
export const listDocumentosQuerySchema = z.object({
  page:  z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().positive().optional(),
  tipo:  z.string().trim().min(1).max(100).optional(),
  anio:  z.coerce.number().int().min(1900).max(CURRENT_YEAR + 1).optional(),
  q:     z.string().trim().max(200).optional(),
  admin: z.enum(['true', 'false']).optional(),
});
