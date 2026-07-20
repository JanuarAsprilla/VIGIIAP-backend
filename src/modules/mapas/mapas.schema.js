import { z } from 'zod';

// URLs solo permitidas del almacenamiento propio (R2) o del geovisor institucional.
// Previene que un admin comprometido apunte recursos a dominios maliciosos externos.
function trustedUrl(allowExternal = false) {
  return z.string().url('URL inválida').refine(
    (url) => {
      if (allowExternal) return true; // geovisor puede ser externo
      const r2Private = process.env.R2_PUBLIC_URL ?? '';
      const r2Public  = process.env.R2_PUBLIC_BUCKET_URL ?? '';
      return url.startsWith(r2Private) || url.startsWith(r2Public);
    },
    { message: 'URL debe pertenecer al almacenamiento propio (R2)' },
  ).optional().or(z.literal('')).transform(v => v || null);
}
const optionalUrl    = trustedUrl(false);
const optionalUrlExt = trustedUrl(true); // geovisor puede ser externo (ArcGIS, etc.)
const visibilidadEnum = z.enum(['publico', 'usuarios', 'acreditados']).default('publico');
const CURRENT_YEAR = new Date().getFullYear();

const mapaBase = z.object({
  titulo:          z.string().min(3, 'Título requerido (mín. 3 caracteres)'),
  categoria:       z.string().min(2, 'Categoría requerida'),
  anio:            z.coerce.number().int().min(1900).max(CURRENT_YEAR + 1).optional(),
  descripcion:     z.string().optional(),
  thumbnail_url:   optionalUrl,
  archivo_pdf_url: optionalUrl,
  archivo_img_url: optionalUrl,
  geovisor_url:    optionalUrlExt,
  visibilidad:     visibilidadEnum,
  // Metadatos geoespaciales (ISO 19115 / IGAC)
  epsg:       z.coerce.number().int().positive().optional(),
  escala:     z.coerce.number().int().min(500).max(5_000_000).optional(),
  fuente:     z.string().min(3).max(200).optional(),
  bbox_norte: z.coerce.number().min(-90).max(90).optional(),
  bbox_sur:   z.coerce.number().min(-90).max(90).optional(),
  bbox_este:  z.coerce.number().min(-180).max(180).optional(),
  bbox_oeste: z.coerce.number().min(-180).max(180).optional(),
});

export const createMapaSchema = mapaBase
  .refine(
    (d) => !d.bbox_norte || !d.bbox_sur || d.bbox_norte > d.bbox_sur,
    { message: 'bbox_norte debe ser mayor que bbox_sur', path: ['bbox_norte'] },
  )
  .refine(
    (d) => !d.bbox_este || !d.bbox_oeste || d.bbox_este > d.bbox_oeste,
    { message: 'bbox_este debe ser mayor que bbox_oeste', path: ['bbox_este'] },
  );

export const updateMapaSchema = mapaBase.partial().refine(
  (d) => Object.values(d).some((v) => v !== undefined),
  { message: 'Debe enviar al menos un campo a actualizar' },
);

export const toggleMapaSchema = z.object({
  activo: z.coerce.boolean(),
});
