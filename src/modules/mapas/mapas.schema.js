import { z } from 'zod';

// URLs solo permitidas del almacenamiento propio (R2) o del geovisor institucional.
// Previene que un admin comprometido apunte recursos a dominios maliciosos externos.
function trustedUrl(allowExternal = false) {
  return z.string().url('URL inválida').refine(
    (url) => {
      if (allowExternal) return true; // geovisor puede ser externo
      const r2Private = process.env.R2_PUBLIC_URL;
      const r2Public  = process.env.R2_PUBLIC_BUCKET_URL;
      // Si una de las variables no está configurada, no debe actuar como comodín
      // (startsWith('') es true para cualquier string) — solo compara contra valores reales.
      return (!!r2Private && url.startsWith(r2Private)) || (!!r2Public && url.startsWith(r2Public));
    },
    { message: 'URL debe pertenecer al almacenamiento propio (R2)' },
  ).optional().or(z.literal('')).transform(v => v || null);
}
const optionalUrl    = trustedUrl(false);
const optionalUrlExt = trustedUrl(true); // geovisor puede ser externo (ArcGIS, etc.)
const visibilidadEnum = z.enum(['publico', 'usuarios', 'acreditados']).default('publico');
const CURRENT_YEAR = new Date().getFullYear();

// Campos opcionales que el admin puede borrar explícitamente desde el
// formulario (mandan '' para "quitar este dato"). Sin este preprocess, ''
// entra directo a z.coerce.number()/z.string().min(...) y revienta la
// validación (Number('') = 0, no positive; '' no cumple min(3)) en vez de
// limpiarse. '' se normaliza a null ANTES de validar -- .nullable() deja
// pasar null sin tocar el resto de la cadena, así que sigue siendo un valor
// "presente" (no undefined) y update() sí lo manda a limpiar la columna,
// a diferencia de omitir el campo del todo (que update() interpreta como
// "no tocar esta columna").
function clearable(schema) {
  return z.preprocess((v) => (v === '' ? null : v), schema.nullable().optional());
}

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
  // Metadatos geoespaciales (ISO 19115 / IGAC) -- todos opcionales y
  // borrables (ver clearable() arriba).
  epsg:       clearable(z.coerce.number().int().positive()),
  escala:     clearable(z.coerce.number().int().min(500).max(5_000_000)),
  fuente:     clearable(z.string().min(3).max(200)),
  bbox_norte: clearable(z.coerce.number().min(-90).max(90)),
  bbox_sur:   clearable(z.coerce.number().min(-90).max(90)),
  bbox_este:  clearable(z.coerce.number().min(-180).max(180)),
  bbox_oeste: clearable(z.coerce.number().min(-180).max(180)),
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
