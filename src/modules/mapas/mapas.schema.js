import { z } from 'zod';

const optionalUrl = z.string().url('URL inválida').optional().or(z.literal('')).transform(v => v || null);
const visibilidadEnum = z.enum(['publico', 'usuarios', 'acreditados']).default('publico');
const CURRENT_YEAR = new Date().getFullYear();

const mapaBase = z.object({
  titulo:          z.string().min(3, 'Título requerido (mín. 3 caracteres)'),
  categoria:       z.string().min(2, 'Categoría requerida'),
  anio:            z.coerce.number().int().min(1900).max(2100).optional(),
  descripcion:     z.string().optional(),
  thumbnail_url:   optionalUrl,
  archivo_pdf_url: optionalUrl,
  archivo_img_url: optionalUrl,
  geovisor_url:    optionalUrl,
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

export const createMapaSchema = mapaBase;

export const updateMapaSchema = mapaBase.partial().refine(
  (d) => Object.values(d).some((v) => v !== undefined),
  { message: 'Debe enviar al menos un campo a actualizar' },
);

export const toggleMapaSchema = z.object({
  activo: z.coerce.boolean(),
});
