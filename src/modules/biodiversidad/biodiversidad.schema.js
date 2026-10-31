import { z } from 'zod';

export const GRUPOS = ['aves', 'mamiferos', 'anfibios', 'reptiles', 'insectos', 'plantas', 'hongos'];
export const TAMANO_MAXIMO = 100;
/** pagina × tamano máximo: evita barridos completos; para volúmenes mayores habrá descargas. */
export const PROFUNDIDAD_MAXIMA = 10_000;
export const CAMPOS_OPCIONES = ['reino', 'division', 'clase', 'orden', 'familia', 'genero', 'entidad', 'conjunto', 'tipo_evidencia', 'anio'];
export const LIMITE_PUNTOS = 1500;
export const LIMITE_PUNTOS_MAXIMO = 2000;
export const LIMITE_OPCIONES = 100;
export const LIMITE_OPCIONES_MAXIMO = 200;

const grupo = z.enum(GRUPOS);
const entero = (min, max) => z.coerce.number().int().min(min).max(max);
const verdadero = () => z.enum(['true']).transform(() => true).optional();

// strictObject: cualquier parámetro no declarado (incluidos intentos de ordenar o filtrar
// por columnas internas) se rechaza en vez de ignorarse. Un parámetro repetido llega como arreglo
// y también se rechaza.
const territorio = {
  codigo_municipal: z.string().regex(/^[A-Za-z0-9_-]{1,20}$/, 'Código de municipio inválido').optional(),
  departamento: z.string().trim().min(2).max(60).optional(),
};

/** Nombre de un taxón: coincidencia exacta, sin comodines. */
const taxon = z.string().trim().min(2).max(80)
  .regex(/^[\p{L}\p{M} .'()-]+$/u, 'Solo letras, espacios y . - \' ( )').optional();
const uuid = z.string().trim().regex(/^[0-9a-fA-F]{8}(-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12}$/, 'Identificador inválido')
  .transform((v) => v.toLowerCase()).optional();

// `orden_taxon` es el orden taxonómico en TODAS las rutas. En las rutas sin parámetro de ordenamiento
// (municipios, resumen, series, puntos, opciones) se admite además `orden` como sinónimo; en /especies
// y /registros `orden` es el ordenamiento (compatibilidad con la v2).
const taxonomia = {
  reino: taxon, division: taxon, clase: taxon, orden_taxon: taxon, familia: taxon, genero: taxon,
};
const especie = {
  especie_clave: z.string().regex(/^[A-Za-z0-9]{1,20}$/, 'Clave de especie inválida').optional(),
  buscar: z.string().trim().min(2).max(60).optional(),
  conservacion: z.enum(['amenazada', 'endemica', 'introducida', 'invasora']).optional(),
  amenaza: z.enum(['CR', 'EN', 'VU']).optional(),
};
const registro = {
  entidad_clave: uuid,
  dataset_key: uuid,
  anio_desde: entero(1900, 2100).optional(),
  anio_hasta: entero(1900, 2100).optional(),
  tipo_evidencia: z.string().regex(/^[A-Z_]{3,40}$/, 'Tipo de evidencia inválido').optional(),
  con_foto: verdadero(),
  con_ubicacion: verdadero(),
};
/** Juego común de filtros: mismos nombres y reglas en todas las rutas que los admiten. */
export const FILTROS = { ...territorio, ...taxonomia, ...especie, ...registro };

const paginacion = {
  pagina: entero(1, PROFUNDIDAD_MAXIMA).default(1),
  tamano: entero(1, TAMANO_MAXIMO).default(25),
};

const limitarProfundidad = (esquema) => esquema.refine((d) => d.pagina * d.tamano <= PROFUNDIDAD_MAXIMA, {
  message: `Solo se pueden paginar los primeros ${PROFUNDIDAD_MAXIMA} resultados; acota con filtros`,
  path: ['pagina'],
});

const rangoDeAnios = (esquema) => esquema.refine((d) => d.anio_desde == null || d.anio_hasta == null || d.anio_desde <= d.anio_hasta, {
  message: 'anio_desde no puede ser mayor que anio_hasta',
  path: ['anio_desde'],
});

const conFiltros = (forma = {}) => rangoDeAnios(z.strictObject({ grupo, ...FILTROS, ...forma }));

/** Variante para rutas sin ordenamiento: `orden` (taxón) se traslada a `orden_taxon`. */
const conOrdenTaxonomico = (forma = {}) => conFiltros({ orden: taxon, ...forma }).transform(({ orden, ...resto }, ctx) => {
  if (orden == null) return resto;
  if (resto.orden_taxon != null) {
    ctx.addIssue({ code: 'custom', message: 'Use orden u orden_taxon, no ambos', path: ['orden'] });
    return z.NEVER;
  }
  return { ...resto, orden_taxon: orden };
});

export const municipiosQuerySchema = conOrdenTaxonomico();
export const resumenQuerySchema = conOrdenTaxonomico();
export const seriesQuerySchema = conOrdenTaxonomico();

export const especiesQuerySchema = limitarProfundidad(conFiltros({
  orden: z.enum(['registros', 'nombre', 'municipios']).default('registros'),
  ...paginacion,
}));

export const registrosQuerySchema = limitarProfundidad(conFiltros({
  orden: z.enum(['anio_desc', 'anio_asc', 'especie']).default('anio_desc'),
  ...paginacion,
}));

const NUMERO = /^-?\d+(\.\d+)?$/;

/** `minLon,minLat,maxLon,maxLat` → cuatro números dentro de rango y con mínimo ≤ máximo. */
function leerCaja(texto, ctx) {
  const partes = texto.split(',');
  const invalido = () => { ctx.addIssue({ code: 'custom', message: 'bbox debe ser minLon,minLat,maxLon,maxLat dentro de rango' }); return z.NEVER; };
  if (partes.length !== 4 || !partes.every((p) => NUMERO.test(p))) return invalido();
  const [minLon, minLat, maxLon, maxLat] = partes.map(Number);
  const enRango = Math.abs(minLon) <= 180 && Math.abs(maxLon) <= 180 && Math.abs(minLat) <= 90 && Math.abs(maxLat) <= 90;
  if (!enRango || minLon > maxLon || minLat > maxLat) return invalido();
  return [minLon, minLat, maxLon, maxLat];
}

export const puntosQuerySchema = conOrdenTaxonomico({
  bbox: z.string().transform(leerCaja).optional(),
  limite: entero(1, LIMITE_PUNTOS_MAXIMO).default(LIMITE_PUNTOS),
});

/** `buscar` en /opciones filtra las etiquetas de las opciones (no el nombre de la especie). */
export const opcionesQuerySchema = conOrdenTaxonomico({
  campo: z.enum(CAMPOS_OPCIONES),
  buscar: z.string().trim().min(2).max(60).regex(/^[\p{L}\p{N}\p{M} .'()-]+$/u, 'Solo letras, números y espacios').optional(),
  limite: entero(1, LIMITE_OPCIONES_MAXIMO).default(LIMITE_OPCIONES),
});

export const registroParamsSchema = z.strictObject({
  gbif_id: z.string().regex(/^[0-9]{1,20}$/, 'Identificador de registro inválido'),
});

export const detalleQuerySchema = z.strictObject({ grupo });
