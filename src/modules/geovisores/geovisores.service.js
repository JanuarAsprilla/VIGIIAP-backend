import { query } from '../../config/database.js';
import { paginate } from '../../utils/paginate.js';
import { slugify } from '../../utils/slugify.js';
import { deleteFile, extractKey } from '../../config/r2.js';
import { obtenerConexionParaConector } from './conexionesGeoserver.service.js';
import { obtenerCapasNuevas } from './capasNuevas.service.js';
import * as geoserver from './geoserver.connector.js';
import logger from '../../utils/logger.js';
import { adjuntarFichasAFeatures, obtenerConfig as obtenerConfigFichas, listarFeaturesConCompletitud } from '../fichas/fichas.service.js';

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

/**
 * Misma regla de acceso que obtenerCatalogoDeGeovisor (capas_seleccionadas o, en su defecto,
 * workspaces_geoserver + exclusión fija), pero aplicada a un capaId puntual -- los proxies
 * WMS/leyenda/consulta reciben el capaId directo del cliente, así que sin esta validación un
 * geovisor podría exponer CUALQUIER capa de su conexión GeoServer (incluida la de comunidades
 * étnicas) con solo conocer o adivinar su id, saltándose por completo la curaduría que el
 * catálogo sí aplica.
 *
 * Orden de reglas (la exclusión de seguridad SIEMPRE va primero, capasSeleccionadas no la
 * puede saltar):
 *   1. Workspace en WORKSPACES_SIEMPRE_EXCLUIDOS → nunca, pase lo que pase.
 *   2. capasSeleccionadas no vacío → allow-list exacta por capa, sin importar el workspace
 *      (esto es lo que permite mezclar capas de temas distintos en un mismo geovisor). Con
 *      incluirCapasNuevas, además se admite cualquier capa de los workspaces ya usados -- así una
 *      capa publicada después en GeoServer aparece sola, sin editar el geovisor.
 *   3. Si no, comportamiento legado: workspacesGeoserver vacío = toda la conexión; si no,
 *      cualquier capa de esos workspaces.
 */
const RANGO_VISIBILIDAD = { publico: 0, usuarios: 1, acreditados: 2 };
function esMasRestrictiva(visibilidadCandidata, visibilidadReferencia) {
  return (RANGO_VISIBILIDAD[visibilidadCandidata] ?? 0) > (RANGO_VISIBILIDAD[visibilidadReferencia] ?? 0);
}
const SIN_RESTRICCIONES_DE_HERMANOS = { workspaces: new Set(), capas: new Set() };

/**
 * Varios geovisores pueden compartir una misma conexionGeoserverId (ver
 * docs/PORTAL_GEOVISORES_DISENO.md §6) -- cada uno con su propio nivel de
 * visibilidad. Sin este chequeo, un geovisor público con workspacesGeoserver
 * vacío ("comportamiento legado: toda la conexión") expone cualquier capa
 * que un geovisor HERMANO, en la MISMA conexión, haya reservado
 * explícitamente para un nivel de visibilidad más restrictivo -- el
 * atacante solo necesita conocer o adivinar el capaId, no pasar por el
 * geovisor restringido en absoluto.
 * Ver audit finding geovisor-shared-connection-layer-bypass.
 */
async function obtenerRestriccionesDeHermanos(conexionGeoserverId, geovisorId, visibilidadActual) {
  const { rows } = await query(
    `SELECT workspaces_geoserver, capas_seleccionadas, visibilidad
     FROM geovisores
     WHERE conexion_geoserver_id = $1 AND id != $2 AND deleted_at IS NULL AND activo = true`,
    [conexionGeoserverId, geovisorId],
  );
  const workspaces = new Set();
  const capas = new Set();
  for (const fila of rows) {
    if (!esMasRestrictiva(fila.visibilidad, visibilidadActual)) continue;
    for (const w of fila.workspaces_geoserver ?? []) workspaces.add(w);
    for (const c of fila.capas_seleccionadas ?? []) capas.add(c);
  }
  return { workspaces, capas };
}

function capaPermitidaEnGeovisor(geovisor, capaId, restricciones = SIN_RESTRICCIONES_DE_HERMANOS) {
  const workspace = workspaceDeCapa(capaId);
  if (WORKSPACES_SIEMPRE_EXCLUIDOS.includes(workspace)) return false;
  // Reserva explícita de un hermano más restrictivo: gana siempre, sin
  // importar cómo esté configurado este geovisor (capasSeleccionadas o
  // comportamiento legado incluidos).
  if (restricciones.capas.has(capaId) || restricciones.workspaces.has(workspace)) return false;
  if (geovisor.capasSeleccionadas.length > 0) {
    if (geovisor.capasSeleccionadas.includes(capaId)) return true;
    if (!geovisor.incluirCapasNuevas) return false;
    return geovisor.workspacesGeoserver.includes(workspace)
      || geovisor.capasSeleccionadas.some((c) => workspaceDeCapa(c) === workspace);
  }
  if (geovisor.workspacesGeoserver.length === 0) return true;
  return geovisor.workspacesGeoserver.includes(workspace);
}

function exigirCapaPermitida(geovisor, capaId, restricciones = SIN_RESTRICCIONES_DE_HERMANOS) {
  if (!capaPermitidaEnGeovisor(geovisor, capaId, restricciones)) {
    throw Object.assign(
      new Error(`La capa "${capaId}" no está disponible en este geovisor`),
      { status: 403, code: 'CAPA_NO_PERMITIDA' },
    );
  }
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
    capasSeleccionadas: fila.capas_seleccionadas,
    capasConFicha: fila.capas_con_ficha,
    incluirCapasNuevas: fila.incluir_capas_nuevas === true,
    colorPorTema: fila.color_por_tema,
    centro: { lat: fila.centro_lat, lng: fila.centro_lng },
    zoomInicial: fila.zoom_inicial,
    basemapDefecto: fila.basemap_defecto,
    areaMaxHa: fila.area_max_ha,
    presetsArea: fila.presets_area,
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

  const condiciones = isAdminView ? ['deleted_at IS NULL'] : ['activo = true', 'deleted_at IS NULL'];
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
    `SELECT * FROM geovisores WHERE slug = $1 AND activo = true AND deleted_at IS NULL ${filtroVisibilidad}`,
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
       workspaces_geoserver, capas_seleccionadas, capas_con_ficha, incluir_capas_nuevas, color_por_tema, centro_lat, centro_lng, zoom_inicial,
       basemap_defecto, area_max_ha, presets_area, visibilidad, presentacion,
       thumbnail_url, creado_por
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22)
     RETURNING *`,
    [
      slug, data.titulo, data.subtitulo ?? null, data.descripcion ?? null, data.cita ?? null,
      data.categoria ?? null, data.conexionGeoserverId, data.workspacesGeoserver ?? [],
      data.capasSeleccionadas ?? [], data.capasConFicha ?? [], data.incluirCapasNuevas ?? false, JSON.stringify(data.colorPorTema ?? {}), data.centroLat, data.centroLng, data.zoomInicial ?? 8,
      data.basemapDefecto ?? 'calles', data.areaMaxHa ?? null, JSON.stringify(data.presetsArea ?? []),
      data.visibilidad ?? 'publico',
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
  workspacesGeoserver: 'workspaces_geoserver', capasSeleccionadas: 'capas_seleccionadas',
  capasConFicha: 'capas_con_ficha', incluirCapasNuevas: 'incluir_capas_nuevas',
  zoomInicial: 'zoom_inicial',
  basemapDefecto: 'basemap_defecto', areaMaxHa: 'area_max_ha',
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
    `UPDATE geovisores SET ${campos.join(', ')} WHERE id = $${indice} AND deleted_at IS NULL RETURNING *`,
    valores,
  );
  if (!rows[0]) throw Object.assign(new Error('Geovisor no encontrado'), { status: 404 });
  return filaAGeovisor(rows[0]);
}

/** Reemplaza la miniatura y borra la anterior de R2 -- mismo patrón que categorias.service.js. */
export async function updateThumbnail(id, newUrl) {
  const { rows: prev } = await query(
    'SELECT thumbnail_url FROM geovisores WHERE id = $1 AND deleted_at IS NULL',
    [id],
  );
  if (!prev[0]) throw Object.assign(new Error('Geovisor no encontrado'), { status: 404 });
  const oldUrl = prev[0].thumbnail_url;

  const result = await update(id, { thumbnailUrl: newUrl });

  if (oldUrl && oldUrl !== newUrl) {
    const key = extractKey(oldUrl);
    if (key) await deleteFile(key).catch((err) => logger.warn('[r2] delete failed', { key, error: err.message }));
  }

  return result;
}

/** GET .../geovisores/:id -- lectura admin directa por id (bypassa visibilidad, a diferencia de getBySlug). */
export async function getById(id) {
  const { rows } = await query('SELECT * FROM geovisores WHERE id = $1 AND deleted_at IS NULL', [id]);
  if (!rows[0]) throw Object.assign(new Error('Geovisor no encontrado'), { status: 404 });
  return filaAGeovisor(rows[0]);
}

/**
 * Completitud de un geovisor: por cada capa en capasConFicha, ¿tiene config
 * (identificador elegido) y todas sus fichas completas (descripción + al
 * menos un medio)? Identificadores duplicados/huérfanos NO bloquean (son
 * avisos, ver plan) -- solo features incompletas o sin identificador.
 * Sin capasConFicha, siempre publicable=true (comportamiento legado intacto).
 */
export async function calcularCompletitud(id) {
  const geovisor = await getById(id);

  const capas = await Promise.all((geovisor.capasConFicha ?? []).map(async (capaId) => {
    const config = await obtenerConfigFichas(geovisor.conexionGeoserverId, capaId);
    if (!config) {
      // La capa tiene el modo habilitado pero nadie eligió todavía un
      // identificador -- no hay forma de que exista ni una sola ficha, bloquea.
      return { capaId, nombre: capaId, resumen: null, bloqueantes: null, sinConfigurar: true };
    }
    const { resumen } = await listarFeaturesConCompletitud(config.id);
    return { capaId, nombre: capaId, resumen, bloqueantes: resumen.incompletas + resumen.sinIdentificador };
  }));

  const publicable = capas.every((c) => !c.sinConfigurar && c.bloqueantes === 0);
  return { publicable, capas };
}

export async function toggleActivo(id, activo) {
  // Activar SÍ se valida contra completitud; desactivar NUNCA se bloquea (ver
  // plan: corregir un geovisor publicado siempre debe poder desactivarse).
  if (activo) {
    const completitud = await calcularCompletitud(id);
    if (!completitud.publicable) {
      throw Object.assign(
        new Error('Este geovisor tiene capas con fichas por punto incompletas -- no se puede publicar todavía'),
        { status: 409, code: 'GEOVISOR_INCOMPLETO', fields: completitud },
      );
    }
  }

  const { rows } = await query(
    'UPDATE geovisores SET activo = $1, actualizado_en = NOW() WHERE id = $2 AND deleted_at IS NULL RETURNING *',
    [activo, id],
  );
  if (!rows[0]) throw Object.assign(new Error('Geovisor no encontrado'), { status: 404 });
  return filaAGeovisor(rows[0]);
}

// Soft delete -- IIAP es entidad del Estado colombiano, los datos geoespaciales no se destruyen
// permanentemente (ver db/migrations/021_soft_deletes.sql). Antes era un DELETE físico sin red de
// seguridad; ahora pasa por Papelera como mapas/documentos/categorías.
export async function remove(id) {
  const { rowCount } = await query(
    `UPDATE geovisores SET deleted_at = NOW(), actualizado_en = NOW() WHERE id = $1 AND deleted_at IS NULL`,
    [id],
  );
  if (!rowCount) throw Object.assign(new Error('Geovisor no encontrado'), { status: 404 });
}

/**
 * Catálogo de capas de UN geovisor: descubre en vivo contra su conexión GeoServer y filtra con
 * la misma regla que capaPermitidaEnGeovisor (capas_seleccionadas, o en su defecto
 * workspaces_geoserver, más la exclusión de seguridad fija), agrupa por tema.
 * Espejo de catalogoCapas.ts de producto6, adaptado a "un geovisor entre varios" en vez de "la
 * única instalación".
 */
export async function obtenerCatalogoDeGeovisor(slug, user) {
  const geovisor = await getBySlug(slug, user);
  const conexion = await obtenerConexionParaConector(geovisor.conexionGeoserverId);

  const [vectoriales, raster, restricciones] = await Promise.all([
    geoserver.obtenerCapacidadesWfs(conexion),
    geoserver.obtenerCapacidadesWcs(conexion),
    obtenerRestriccionesDeHermanos(geovisor.conexionGeoserverId, geovisor.id, geovisor.visibilidad),
  ]);

  const descubiertas = [...vectoriales, ...raster];
  // Se registran TODAS las capas de la conexión (no solo las de este geovisor): la línea base de
  // "qué ya existía" es por conexión, y varios geovisores comparten la misma.
  const nuevas = await obtenerCapasNuevas(geovisor.conexionGeoserverId, descubiertas.map((capa) => capa.id));

  const capas = descubiertas
    .filter((capa) => capaPermitidaEnGeovisor(geovisor, capa.id, restricciones))
    .map((capa) => ({ ...capa, nueva: nuevas.has(capa.id), tema: temaDesdeWorkspace(workspaceDeCapa(capa.id)).id }));

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

/**
 * Workspaces (temas) publicados por una conexión GeoServer, con conteo de capas -- para el
 * selector del constructor de geovisores ANTES de que exista un geovisor guardado (a diferencia
 * de obtenerCatalogoDeGeovisor, que ya filtra por workspaces_geoserver de un geovisor existente,
 * aquí se listan TODOS los disponibles en la conexión para elegir cuáles usar).
 */
export async function listarWorkspacesDeConexion(conexionId) {
  const conexion = await obtenerConexionParaConector(conexionId);

  const [vectoriales, raster] = await Promise.all([
    geoserver.obtenerCapacidadesWfs(conexion),
    geoserver.obtenerCapacidadesWcs(conexion),
  ]);

  const descubiertas = [...vectoriales, ...raster];
  const nuevas = await obtenerCapasNuevas(conexionId, descubiertas.map((capa) => capa.id));
  const capas = descubiertas
    .filter((capa) => !WORKSPACES_SIEMPRE_EXCLUIDOS.includes(workspaceDeCapa(capa.id)))
    .map((capa) => ({ ...capa, nueva: nuevas.has(capa.id) }));

  // `id` es el workspace CRUDO de GeoServer (ej. "t_20_hidrologia"), el mismo valor que
  // geovisor.workspacesGeoserver guarda y que capaPermitidaEnGeovisor compara -- no el id de tema
  // "bonito" (sin el prefijo t_NN_) que solo sirve para agrupar visualmente en el catálogo público.
  // `capas` viaja completo (no solo el conteo) porque el constructor visual de geovisores necesita
  // los ids reales para pintarlas en la vista previa en vivo -- un WMS GetMap exige nombres de capa
  // explícitos, GeoServer no tiene comodín "todo el workspace".
  const workspacesPorId = new Map();
  for (const capa of capas) {
    const workspace = workspaceDeCapa(capa.id);
    const existente = workspacesPorId.get(workspace);
    if (existente) {
      existente.capas.push(capa);
      existente.totalCapas += 1;
      if (capa.nueva) existente.totalNuevas += 1;
      continue;
    }
    const { nombre } = temaDesdeWorkspace(workspace);
    workspacesPorId.set(workspace, { id: workspace, nombre, totalCapas: 1, totalNuevas: capa.nueva ? 1 : 0, capas: [capa] });
  }
  return [...workspacesPorId.values()].sort((a, b) => a.nombre.localeCompare(b.nombre));
}

/** Proxy WMS GetMap de un geovisor -- resuelve su conexión, valida la(s) capa(s) pedidas y delega al conector. */
export async function proxyWmsDeGeovisor(slug, queryParams, geometriaFiltro, user) {
  const geovisor = await getBySlug(slug, user);
  const capasPedidas = (queryParams.get('layers') ?? '').split(',').map((c) => c.trim()).filter(Boolean);
  const restricciones = await obtenerRestriccionesDeHermanos(geovisor.conexionGeoserverId, geovisor.id, geovisor.visibilidad);
  capasPedidas.forEach((capaId) => exigirCapaPermitida(geovisor, capaId, restricciones));
  const conexion = await obtenerConexionParaConector(geovisor.conexionGeoserverId);
  return geoserver.proxyWms(conexion, queryParams, geometriaFiltro);
}

/** Proxy WMS GetLegendGraphic de un geovisor -- resuelve su conexión, valida la capa y delega al conector. */
export async function proxyLeyendaDeGeovisor(slug, capaId, user) {
  const geovisor = await getBySlug(slug, user);
  const restricciones = await obtenerRestriccionesDeHermanos(geovisor.conexionGeoserverId, geovisor.id, geovisor.visibilidad);
  exigirCapaPermitida(geovisor, capaId, restricciones);
  const conexion = await obtenerConexionParaConector(geovisor.conexionGeoserverId);
  return geoserver.proxyLeyenda(conexion, capaId);
}

/**
 * Consulta los atributos de las features de una capa que intersectan una geometría (el pequeño
 * polígono que arma el cliente alrededor de un clic en el mapa) -- es el WFS GetFeature que
 * alimenta el popup de "click sobre una capa", separado del catálogo (que solo lista qué existe).
 */
export async function consultarCapaDeGeovisor(slug, capaId, geometria, user) {
  const geovisor = await getBySlug(slug, user);
  const restricciones = await obtenerRestriccionesDeHermanos(geovisor.conexionGeoserverId, geovisor.id, geovisor.visibilidad);
  exigirCapaPermitida(geovisor, capaId, restricciones);
  const conexion = await obtenerConexionParaConector(geovisor.conexionGeoserverId);
  const coleccion = await geoserver.consultarWfs(conexion, capaId, geometria);

  // Capas sin el modo "fichas por punto" no cambian -- compatibilidad hacia
  // atrás garantizada (ver adjuntarFichasAFeatures en fichas.service.js).
  // `?? []` cubre fixtures de test anteriores a la migración 053 -- en BD la
  // columna es NOT NULL DEFAULT '{}', nunca llega undefined en producción.
  if (!(geovisor.capasConFicha ?? []).includes(capaId)) return coleccion;
  return adjuntarFichasAFeatures(geovisor.conexionGeoserverId, capaId, coleccion);
}
