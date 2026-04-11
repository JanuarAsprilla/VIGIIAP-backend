import { z } from 'zod';

const optionalUrl = z.string().url('URL inválida').optional().or(z.literal('')).transform(v => v || null);

const mapaBase = z.object({
  titulo:          z.string().min(3, 'Título requerido (mín. 3 caracteres)'),
  categoria:       z.string().min(2, 'Categoría requerida'),
  anio:            z.coerce.number().int().min(1900).max(2100).optional(),
  descripcion:     z.string().optional(),
  thumbnail_url:   optionalUrl,
  archivo_pdf_url: optionalUrl,
  archivo_img_url: optionalUrl,
  geovisor_url:    optionalUrl,
});

export const createMapaSchema = mapaBase;

export const updateMapaSchema = mapaBase.partial().extend({
  titulo:    z.string().min(3, 'Título requerido (mín. 3 caracteres)'),
  categoria: z.string().min(2, 'Categoría requerida'),
});
