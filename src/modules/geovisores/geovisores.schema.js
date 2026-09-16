import { z } from 'zod';

const visibilidadEnum = z.enum(['publico', 'usuarios', 'acreditados']).default('publico');

const presetAreaSchema = z.object({
  nombre: z.string().min(1).max(100),
  geometria: z.object({
    type: z.enum(['Polygon', 'MultiPolygon']),
    coordinates: z.array(z.unknown()),
  }),
});

const geovisorBase = z.object({
  // El slug se genera en el servidor a partir del título (slugify), mismo patrón que mapas.service.js
  // -- nunca lo provee el cliente.
  titulo: z.string().min(3, 'Título requerido (mín. 3 caracteres)').max(200),
  subtitulo: z.string().max(200).optional(),
  descripcion: z.string().max(2000).optional(),
  cita: z.string().max(500).optional(),
  categoria: z.string().min(2).optional(),
  conexionGeoserverId: z.string().uuid(),
  workspacesGeoserver: z.array(z.string()).default([]),
  colorPorTema: z.record(z.string(), z.string()).default({}),
  centroLat: z.coerce.number().min(-90).max(90),
  centroLng: z.coerce.number().min(-180).max(180),
  zoomInicial: z.coerce.number().int().min(0).max(22).default(8),
  basemapDefecto: z.string().min(1).default('calles'),
  areaMaxHa: z.coerce.number().positive().optional(),
  presetsArea: z.array(presetAreaSchema).default([]),
  iaHabilitada: z.coerce.boolean().default(false),
  visibilidad: visibilidadEnum,
  thumbnailUrl: z.string().url().optional(),
});

export const createGeovisorSchema = geovisorBase;

export const updateGeovisorSchema = geovisorBase.partial().refine(
  (d) => Object.values(d).some((v) => v !== undefined),
  { message: 'Debe enviar al menos un campo a actualizar' },
);

export const toggleGeovisorSchema = z.object({
  activo: z.coerce.boolean(),
});

export const createConexionGeoserverSchema = z.object({
  nombre: z.string().min(2).max(150),
  url: z.string().url(),
  usuarioLectura: z.string().min(1).max(100),
  password: z.string().min(1).max(500),
  timeoutMs: z.coerce.number().int().positive().max(120_000).default(20_000),
});

export const updateConexionGeoserverSchema = z.object({
  nombre: z.string().min(2).max(150).optional(),
  url: z.string().url().optional(),
  usuarioLectura: z.string().min(1).max(100).optional(),
  password: z.string().min(1).max(500).optional(), // solo si se está rotando la contraseña
  timeoutMs: z.coerce.number().int().positive().max(120_000).optional(),
  activo: z.coerce.boolean().optional(),
}).refine(
  (d) => Object.values(d).some((v) => v !== undefined),
  { message: 'Debe enviar al menos un campo a actualizar' },
);
