import { query } from '../../config/database.js';
import { paginate } from '../../utils/paginate.js';
import { slugify } from '../../utils/slugify.js';
import { obtenerConexionParaConector } from './conexionesGeoserver.service.js';
import * as geoserver from './geoserver.connector.js';

// Comunidades étnicas / resguardos indígenas: fuera de TODO catálogo hasta que exista una decisión
// institucional escrita al respecto -- se aplica encima de cualquier `workspaces_geoserver` que un
// admin_sig configure, para que un geovisor mal configurado no pueda exponer estos datos por
// accidente (defensa en profundidad, no solo curaduría).
const WORKSPACES_SIEMPRE_EXCLUIDOS = ['t_32_areas_reglamentacion_especial'];

const PATRON_WORKSPACE_TEMATICO = /^t_\d+_(.+)$/;

function workspaceDeCapa(capaId) {
  return capaId.split(':')[0] ?? capaId;
}

function temaDesdeWorkspace(workspace) {
  const coincidencia = workspace.match(PATRON_WORKSPACE_TEMATICO);
  const id = coincidencia?.[1] ?? workspace;
  const nombre = id
    .split('_')
    .map((palabra) => palabra.charAt(0).toUpperCase() + palabra.slice(1))
    .join(' ');
  return { id, nombre };
}

function filaAGeovisor(fila) {
  return {
    id: fila.id,
    slug: fila.slug,
    titulo: fila.titulo,
    subtitulo: fila.subtitulo,
    descripcion: fila.descripcion,
    cita: fila.cita,
    categoria: fila.categoria,
    conexionGeoserverId: fila.conexion_geoserver_id,
    workspacesGeoserver: fila.workspaces_geoserver,
    colorPorTema: fila.color_por_tema,
    centro: { lat: fila.centro_lat, lng: fila.centro_lng },
    zoomInicial: fila.zoom_inicial,
    basemapDefecto: fila.basemap_defecto,
    areaMaxHa: fila.area_max_ha,
    presetsArea: fila.presets_area,
    iaHabilitada: fila.ia_habilitada,
    visibilidad: fila.visibilidad,
    presentacion: fila.presentacion,
    thumbnailUrl: fila.thumbnail_url,
    activo: fila.activo,
    orden: fila.orden,
    creadoEn: fila.creado_en,
  };
}

/** Visibilidad según rol: mismo criterio que mapas.service.js (visitante/publico solo ven contenido público). */
function visibilidadPermitida(user) {
  if (!user || user.rol === 'visitante' || user.rol === 'publico') return ['publico'];
  if (['admin_sig', 'super_admin', 'investigador', 'tecnico', 'institucional'].includes(user.rol)) return null;
  return ['publico', 'usuarios'];
}

export async function getAll(reqQuery, user) {
  const { limit, offset, meta } = paginate(reqQuery);
  const { categoria, admin } = reqQuery;
  const isAdminView = admin === 'true' && ['admin_sig', 'super_admin'].includes(user?.rol);

  const condiciones = isAdminView ? [] : ['activo = true'];
  const params = [];

  if (!isAdminView) {
    const permitida = visibilidadPermitida(user);
    if (permitida) {
      params.push(permitida);
      condiciones.push(`visibilidad = ANY($${params.length})`);
    }
  }
  if (categoria) {
    params.push(categoria);
    condiciones.push(`categoria = $${params.length}`);
  }

  const where = condiciones.length ? `WHERE ${condiciones.join(' AND ')}` : '';
  params.push(limit, offset);

  const [datos, total] = await Promise.all([
    query(
      `SELECT * FROM geovisores ${where} ORDER BY orden, titulo LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params,
    ),
    query(`SELECT COUNT(*) FROM geovisores ${where}`, params.slice(0, -2)),
  ]);

  return { data: datos.rows.map(filaAGeovisor), meta: meta(Number(total.rows[0].count)) };
}

/**
 * Sin bypass de admin a propósito -- mismo criterio que mapas.service.js: getBySlug es la vía
 * PÚBLICA (también usada internamente por el catálogo/proxy WMS/leyenda, todos alcanzables sin
 * autenticación), así que activo/visibilidad se filtran en la propia consulta SQL, nunca después
 * de traer la fila completa a JS -- un filtro aplicado en la capa de datos no se puede olvidar de
 * invocar desde un nuevo caller futuro; uno aplicado "después de leer" sí. La curaduría admin
 * (ver/editar un geovisor inactivo o restringido) pasa por getAll(?admin=true) + PATCH por id,
 * nunca por esta ruta pública -- por eso este método no necesita ni debe tener excepción alguna.
 */
export async function getBySlug(slug, user) {
  const permitida = visibilidadPermitida(user);
  const filtroVisibilidad = permitida ? 'AND visibilidad = ANY($2)' : '';
  const params = permitida ? [slug, permitida] : [slug];

  const { rows } = await query(
    `SELECT * FROM geovisores WHERE slug = $1 AND activo = true ${filtroVisibilidad}`,
    params,
  );
  if (!rows[0]) throw Object.assign(new Error('Geovisor no encontrado'), { status: 404 });
  return filaAGeovisor(rows[0]);
}

export async function create(data, userId) {
  const slug = slugify(data.titulo);
  const { rows } = await query(
    `INSERT INTO geovisores (
       slug, titulo, subtitulo, descripcion, cita, categoria, conexion_geoserver_id,
       workspaces_geoserver, color_por_tema, centro_lat, centro_lng, zoom_inicial,
       basemap_defecto, area_max_ha, presets_area, ia_habilitada, visibilidad, presentacion,
       thumbnail_url, creado_por
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)
     RETURNING *`,
    [
      slug, data.titulo, data.subtitulo ?? null, data.descripcion ?? null, data.cita ?? null,
      data.categoria ?? null, data.conexionGeoserverId, data.workspacesGeoserver ?? [],
      JSON.stringify(data.colorPorTema ?? {}), data.centroLat, data.centroLng, data.zoomInicial ?? 8,
      data.basemapDefecto ?? 'calles', data.areaMaxHa ?? null, JSON.stringify(data.presetsArea ?? []),
      data.iaHabilitada ?? false, data.visibilidad ?? 'publico',
      JSON.stringify(data.presentacion ?? { mostrarMetricas: true, mostrarImagenes: false, camposPopup: [] }),
      data.thumbnailUrl ?? null, userId,
    ],
  );
  return filaAGeovisor(rows[0]);
}

// slug deliberadamente ausente -- es permanente tras la creación, igual que en mapas.service.js
// (una URL que cambia solo porque alguien corrigió el título rompe cualquier enlace ya compartido).
const MAPA_CAMPOS = {
  titulo: 'titulo', subtitulo: 'subtitulo', descripcion: 'descripcion', cita: 'cita',
  categoria: 'categoria', conexionGeoserverId: 'conexion_geoserver_id',
  workspacesGeoserver: 'workspaces_geoserver', zoomInicial: 'zoom_inicial',
  basemapDefecto: 'basemap_defecto', areaMaxHa: 'area_max_ha', iaHabilitada: 'ia_habilitada',
  visibilidad: 'visibilidad', thumbnailUrl: 'thumbnail_url', centroLat: 'centro_lat', centroLng: 'centro_lng',
};
const MAPA_CAMPOS_JSON = { colorPorTema: 'color_por_tema', presetsArea: 'presets_area', presentacion: 'presentacion' };

export async function update(id, data) {
  const campos = [];
  const valores = [];
  let indice = 1;

  for (const [clave, columna] of Object.entries(MAPA_CAMPOS)) {
    if (data[clave] !== undefined) {
      campos.push(`${columna} = $${indice}`);
      valores.push(data[clave]);
      indice += 1;
    }
  }
  for (const [clave, columna] of Object.entries(MAPA_CAMPOS_JSON)) {
    if (data[clave] !== undefined) {
      campos.push(`${columna} = $${indice}`);
      valores.push(JSON.stringify(data[clave]));
      indice += 1;
    }
  }
  campos.push('actualizado_en = NOW()');

  valores.push(id);
  const { rows } = await query(
    `UPDATE geovisores SET ${campos.join(', ')} WHERE id = $${indice} RETURNING *`,
    valores,
  );
  if (!rows[0]) throw Object.assign(new Error('Geovisor no encontrado'), { status: 404 });
  return filaAGeovisor(rows[0]);
}

export async function toggleActivo(id, activo) {
  const { rows } = await query(
    'UPDATE geovisores SET activo = $1, actualizado_en = NOW() WHERE id = $2 RETURNING *',
    [activo, id],
  );
  if (!rows[0]) throw Object.assign(new Error('Geovisor no encontrado'), { status: 404 });
  return filaAGeovisor(rows[0]);
}

export async function remove(id) {
  const { rowCount } = await query('DELETE FROM geovisores WHERE id = $1', [id]);
  if (!rowCount) throw Object.assign(new Error('Geovisor no encontrado'), { status: 404 });
}

/**
 * Catálogo de capas de UN geovisor: descubre en vivo contra su conexión GeoServer, filtra por
 * `workspaces_geoserver` (vacío = todos) y por la exclusión de seguridad fija, agrupa por tema.
 * Espejo de catalogoCapas.ts de producto6, adaptado a "un geovisor entre varios" en vez de "la
 * única instalación".
 */
export async function obtenerCatalogoDeGeovisor(slug, user) {
  const geovisor = await getBySlug(slug, user);
  const conexion = await obtenerConexionParaConector(geovisor.conexionGeoserverId);

  const [vectoriales, raster] = await Promise.all([
    geoserver.obtenerCapacidadesWfs(conexion),
    geoserver.obtenerCapacidadesWcs(conexion),
  ]);

  const soloEsteGeovisor = geovisor.workspacesGeoserver.length > 0;
  const capas = [...vectoriales, ...raster]
    .filter((capa) => !WORKSPACES_SIEMPRE_EXCLUIDOS.includes(workspaceDeCapa(capa.id)))
    .filter((capa) => !soloEsteGeovisor || geovisor.workspacesGeoserver.includes(workspaceDeCapa(capa.id)))
    .map((capa) => ({ ...capa, tema: temaDesdeWorkspace(workspaceDeCapa(capa.id)).id }));

  const temasPorId = new Map();
  for (const capa of capas) {
    const existente = temasPorId.get(capa.tema);
    if (existente) {
      existente.capas.push(capa);
      continue;
    }
    const { nombre } = temaDesdeWorkspace(workspaceDeCapa(capa.id));
    temasPorId.set(capa.tema, { id: capa.tema, nombre, capas: [capa] });
  }
  return [...temasPorId.values()].sort((a, b) => a.nombre.localeCompare(b.nombre));
}

/** Proxy WMS GetMap de un geovisor -- resuelve su conexión y delega al conector. */
export async function proxyWmsDeGeovisor(slug, queryParams, geometriaFiltro, user) {
  const geovisor = await getBySlug(slug, user);
  const conexion = await obtenerConexionParaConector(geovisor.conexionGeoserverId);
  return geoserver.proxyWms(conexion, queryParams, geometriaFiltro);
}

/** Proxy WMS GetLegendGraphic de un geovisor -- resuelve su conexión y delega al conector. */
export async function proxyLeyendaDeGeovisor(slug, capaId, user) {
  const geovisor = await getBySlug(slug, user);
  const conexion = await obtenerConexionParaConector(geovisor.conexionGeoserverId);
  return geoserver.proxyLeyenda(conexion, capaId);
}
