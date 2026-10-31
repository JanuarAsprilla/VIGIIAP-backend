import { z } from 'zod';

export const GRUPOS = ['aves', 'mamiferos', 'anfibios', 'reptiles', 'insectos', 'plantas', 'hongos'];
export const TAMANO_MAXIMO = 100;
/** pagina × tamano máximo: evita barridos completos; para volúmenes mayores habrá descargas. */
export const PROFUNDIDAD_MAXIMA = 10_000;

const grupo = z.enum(GRUPOS);
const entero = (min, max) => z.coerce.number().int().min(min).max(max);

// strictObject: cualquier parámetro no declarado (incluidos intentos de ordenar o filtrar
// por columnas internas) se rechaza en vez de ignorarse. Un parámetro repetido llega como arreglo
// y también se rechaza.
const territorio = {
  codigo_municipal: z.string().regex(/^[A-Za-z0-9_-]{1,20}$/, 'Código de municipio inválido').optional(),
  departamento: z.string().trim().min(2).max(60).optional(),
};
const especie = {
  buscar: z.string().trim().min(2).max(60).optional(),
  conservacion: z.enum(['amenazada', 'endemica', 'introducida', 'invasora']).optional(),
  amenaza: z.enum(['CR', 'EN', 'VU']).optional(),
};
const paginacion = {
  pagina: entero(1, PROFUNDIDAD_MAXIMA).default(1),
  tamano: entero(1, TAMANO_MAXIMO).default(25),
};

const limitarProfundidad = (esquema) => esquema.refine((d) => d.pagina * d.tamano <= PROFUNDIDAD_MAXIMA, {
  message: `Solo se pueden paginar los primeros ${PROFUNDIDAD_MAXIMA} resultados; acota con filtros`,
  path: ['pagina'],
});

export const municipiosQuerySchema = z.strictObject({ grupo });

export const resumenQuerySchema = z.strictObject({ grupo, ...territorio });

export const seriesQuerySchema = z.strictObject({ grupo, ...territorio });

export const especiesQuerySchema = limitarProfundidad(z.strictObject({
  grupo,
  ...territorio,
  ...especie,
  orden: z.enum(['registros', 'nombre']).default('registros'),
  ...paginacion,
}));

export const registrosQuerySchema = limitarProfundidad(z.strictObject({
  grupo,
  ...territorio,
  ...especie,
  especie_clave: z.string().regex(/^[A-Za-z0-9]{1,20}$/, 'Clave de especie inválida').optional(),
  con_foto: z.enum(['true']).transform(() => true).optional(),
  anio_desde: entero(1900, 2100).optional(),
  anio_hasta: entero(1900, 2100).optional(),
  ...paginacion,
}).refine((d) => d.anio_desde == null || d.anio_hasta == null || d.anio_desde <= d.anio_hasta, {
  message: 'anio_desde no puede ser mayor que anio_hasta',
  path: ['anio_desde'],
}));

export const registroParamsSchema = z.strictObject({
  gbif_id: z.string().regex(/^[0-9]{1,20}$/, 'Identificador de registro inválido'),
});

export const detalleQuerySchema = z.strictObject({ grupo });
