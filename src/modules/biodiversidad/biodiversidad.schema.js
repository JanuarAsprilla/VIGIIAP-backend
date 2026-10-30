import { z } from 'zod';

export const GRUPOS = ['aves', 'mamiferos', 'anfibios', 'reptiles', 'insectos', 'plantas', 'hongos'];
export const TAMANO_MAXIMO = 100;
/** pagina × tamano máximo: evita barridos completos; para volúmenes mayores habrá descargas. */
export const PROFUNDIDAD_MAXIMA = 10_000;

const grupo = z.enum(GRUPOS);
const entero = (min, max) => z.coerce.number().int().min(min).max(max);

// strictObject: cualquier parámetro no declarado (incluidos intentos de ordenar o filtrar
// por columnas internas) se rechaza en vez de ignorarse.
export const municipiosQuerySchema = z.strictObject({ grupo });

export const registrosQuerySchema = z.strictObject({
  grupo,
  codigo_municipal: z.string().regex(/^[A-Za-z0-9_-]{1,20}$/, 'Código de municipio inválido').optional(),
  departamento: z.string().trim().min(2).max(60).optional(),
  anio_desde: entero(1900, 2100).optional(),
  anio_hasta: entero(1900, 2100).optional(),
  pagina: entero(1, PROFUNDIDAD_MAXIMA).default(1),
  tamano: entero(1, TAMANO_MAXIMO).default(25),
})
  .refine((d) => d.anio_desde == null || d.anio_hasta == null || d.anio_desde <= d.anio_hasta, {
    message: 'anio_desde no puede ser mayor que anio_hasta',
    path: ['anio_desde'],
  })
  .refine((d) => d.pagina * d.tamano <= PROFUNDIDAD_MAXIMA, {
    message: `Solo se pueden paginar los primeros ${PROFUNDIDAD_MAXIMA} resultados; acota con filtros`,
    path: ['pagina'],
  });
