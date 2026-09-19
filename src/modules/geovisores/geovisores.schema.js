import { z } from 'zod';

const visibilidadEnum = z.enum(['publico', 'usuarios', 'acreditados']).default('publico');

const presetAreaSchema = z.object({
  nombre: z.string().min(1).max(100),
  geometria: z.object({
    type: z.enum(['Polygon', 'MultiPolygon']),
    coordinates: z.array(z.unknown()),
  }),
});

// Qué atributo real de GeoServer mostrar en el popup/tarjeta de una capa y con qué nombre legible
// -- sin esto, el popup muestra el atributo crudo tal cual viene (ej. "MGUCR_SIMBL"), que no dice
// nada a un usuario no técnico. Hallazgo de la investigación del geoportal SGC: los campos de
// atributo varían genuinamente por temática (ver docs/PORTAL_GEOVISORES_DISENO.md § 6).
const campoPopupSchema = z.object({
  campo: z.string().min(1).max(100),
  alias: z.string().min(1).max(150),
});

// Cómo se presenta la información del geovisor -- decisión del admin_sig al crearlo, separada de
// QUIÉN puede verlo (visibilidad). mostrarImagenes/campoImagenUrl solo aplican si las capas de
// este geovisor traen un atributo con URL de foto (ej. inventarios de campo, manifestaciones
// puntuales) -- camposPopup vacío = mostrar los atributos crudos tal cual vienen (comportamiento
// de respaldo, nunca oculta datos por falta de configuración).
const presentacionSchema = z.object({
  mostrarMetricas: z.coerce.boolean().default(true),
  mostrarImagenes: z.coerce.boolean().default(false),
  campoImagenUrl: z.string().max(100).optional(),
  camposPopup: z.array(campoPopupSchema).default([]),
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
  // Capas individuales elegidas del catálogo en vivo (ids "workspace:layername"),
  // pueden venir de distintos workspaces/temas dentro de la misma conexión.
  // Vacío = comportamiento legado (todas las capas de workspacesGeoserver, o de
  // toda la conexión si workspacesGeoserver también está vacío) — ver
  // obtenerCatalogoDeGeovisor() y capaPermitidaEnGeovisor() en geovisores.service.js.
  capasSeleccionadas: z.array(z.string()).default([]),
  colorPorTema: z.record(z.string(), z.string()).default({}),
  centroLat: z.coerce.number().min(-90).max(90),
  centroLng: z.coerce.number().min(-180).max(180),
  zoomInicial: z.coerce.number().int().min(0).max(22).default(8),
  basemapDefecto: z.string().min(1).default('calles'),
  areaMaxHa: z.coerce.number().positive().optional(),
  presetsArea: z.array(presetAreaSchema).default([]),
  visibilidad: visibilidadEnum,
  // z.object(...).default(x) usa x tal cual, sin volver a pasarlo por el schema -- por eso el
  // default explícito repite los defaults internos en vez de confiar en un {} vacío.
  presentacion: presentacionSchema.default({ mostrarMetricas: true, mostrarImagenes: false, camposPopup: [] }),
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

// tipo 'propio' (GeoServer institucional) exige credenciales; 'externo' (WMS/WFS
// de terceros) no las requiere -- misma invariante reforzada en BD (migración 047).
export const createConexionGeoserverSchema = z.object({
  nombre: z.string().min(2).max(150),
  url: z.string().url(),
  tipo: z.enum(['propio', 'externo']).default('propio'),
  usuarioLectura: z.string().min(1).max(100).optional(),
  password: z.string().min(1).max(500).optional(),
  timeoutMs: z.coerce.number().int().positive().max(120_000).default(20_000),
}).refine(
  (d) => d.tipo === 'externo' || (!!d.usuarioLectura && !!d.password),
  { message: 'Usuario y contraseña son obligatorios para una conexión propia', path: ['usuarioLectura'] },
);

export const updateConexionGeoserverSchema = z.object({
  nombre: z.string().min(2).max(150).optional(),
  url: z.string().url().optional(),
  tipo: z.enum(['propio', 'externo']).optional(),
  usuarioLectura: z.string().min(1).max(100).optional(),
  password: z.string().min(1).max(500).optional(), // solo si se está rotando la contraseña
  timeoutMs: z.coerce.number().int().positive().max(120_000).optional(),
  activo: z.coerce.boolean().optional(),
}).refine(
  (d) => Object.values(d).some((v) => v !== undefined),
  { message: 'Debe enviar al menos un campo a actualizar' },
);
