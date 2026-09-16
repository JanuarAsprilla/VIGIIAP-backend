/**
 * geoserver.connector — Portado desde producto6-reportes-vigia (prototipo aceptado) a
 * VIGIIAP-backend como módulo nativo. Diferencia clave respecto al original: cada función recibe
 * una `conexion` ({ id, url, usuarioLectura, passwordDescifrada, timeoutMs }) en vez de leer
 * env.GEOSERVER_* fijas -- soporta más de un servidor GeoServer (tabla `conexiones_geoserver`)
 * sin cambiar código, como se acordó en docs/PORTAL_GEOVISORES_DISENO.md § 1.
 */
import { geometriaAWkt } from '../../utils/geometry.js';

const MAX_REINTENTOS = 1;

function credencialesBasicAuth(conexion) {
  const credenciales = `${conexion.usuarioLectura}:${conexion.passwordDescifrada}`;
  return Buffer.from(credenciales).toString('base64');
}

async function solicitarConTimeout(conexion, url, aceptar = 'application/json', intento = 0) {
  const controlador = new AbortController();
  const temporizador = setTimeout(() => controlador.abort(), conexion.timeoutMs);

  try {
    const respuesta = await fetch(url, {
      signal: controlador.signal,
      headers: {
        Authorization: `Basic ${credencialesBasicAuth(conexion)}`,
        ...(aceptar ? { Accept: aceptar } : {}),
      },
    });

    if (!respuesta.ok && respuesta.status >= 500 && intento < MAX_REINTENTOS) {
      return solicitarConTimeout(conexion, url, aceptar, intento + 1);
    }

    return respuesta;
  } catch (error) {
    if (intento < MAX_REINTENTOS) {
      return solicitarConTimeout(conexion, url, aceptar, intento + 1);
    }
    throw Object.assign(
      new Error(`GeoServer no respondió a tiempo o no está disponible: ${error.message}`),
      { status: 503, code: 'GEOSERVER_NO_DISPONIBLE' },
    );
  } finally {
    clearTimeout(temporizador);
  }
}

const cachePropiedadGeometria = new Map(); // clave: `${conexion.id}:${capaId}`
const PROPIEDAD_GEOMETRIA_POR_DEFECTO = 'the_geom';

/**
 * El nombre de la columna de geometría de cada capa NO es uniforme (the_geom, geom, shape, ...) —
 * asumir un nombre fijo produce "Illegal property name" en GeoServer para cualquier capa que no
 * lo use. Se resuelve una vez por capa vía WFS DescribeFeatureType y se cachea.
 */
async function obtenerNombrePropiedadGeometria(conexion, capaId) {
  const clave = `${conexion.id}:${capaId}`;
  const cacheada = cachePropiedadGeometria.get(clave);
  if (cacheada) return cacheada;

  const url = new URL(`${conexion.url}/wfs`);
  url.searchParams.set('service', 'WFS');
  url.searchParams.set('version', '2.0.0');
  url.searchParams.set('request', 'DescribeFeatureType');
  url.searchParams.set('typeNames', capaId);

  const respuesta = await solicitarConTimeout(conexion, url);
  if (!respuesta.ok) {
    // No bloquea la consulta: se usa el nombre por defecto y, si tampoco es el correcto, el
    // propio WFS lo rechazará con un error claro que ya maneja consultarWfs.
    return PROPIEDAD_GEOMETRIA_POR_DEFECTO;
  }

  const xml = await respuesta.text();
  const elementos = xml.match(/<xsd:element\b[^>]*\/>/g) ?? [];
  const elementoGeometria = elementos.find((elemento) => {
    const tipo = elemento.match(/\btype="([^"]*)"/)?.[1];
    return tipo?.startsWith('gml:') && tipo.includes('PropertyType');
  });
  const propiedad =
    elementoGeometria?.match(/\bname="([^"]*)"/)?.[1] ?? PROPIEDAD_GEOMETRIA_POR_DEFECTO;

  cachePropiedadGeometria.set(clave, propiedad);
  return propiedad;
}

/**
 * WFS GetFeature con filtro espacial INTERSECTS, construido con parámetros tipados (WKT generado
 * a partir de una geometría ya validada) — nunca concatenando texto de usuario en el CQL_FILTER.
 *
 * El WKT se anota con "SRID=4326;" porque las capas del IIAP no están en WGS84 nativo (verificado
 * contra datos reales: EPSG:9377). Sin esa anotación, GeoServer compara grados contra metros
 * proyectados y la intersección nunca da verdadero. Por la misma razón se pide srsName=EPSG:4326:
 * sin esto, la geometría de salida vuelve en el CRS nativo de la capa (metros), no en grados
 * lat/lon, y cualquier cliente que la pinte en un mapa web estándar la ubica en el lugar
 * equivocado.
 */
export async function consultarWfs(conexion, capaId, geometria) {
  const wkt = `SRID=4326;${geometriaAWkt(geometria)}`;
  const propiedadGeometria = await obtenerNombrePropiedadGeometria(conexion, capaId);

  const url = new URL(`${conexion.url}/wfs`);
  url.searchParams.set('service', 'WFS');
  url.searchParams.set('version', '2.0.0');
  url.searchParams.set('request', 'GetFeature');
  url.searchParams.set('typeNames', capaId);
  url.searchParams.set('outputFormat', 'application/json');
  url.searchParams.set('srsName', 'EPSG:4326');
  url.searchParams.set('CQL_FILTER', `INTERSECTS(${propiedadGeometria}, ${wkt})`);

  const respuesta = await solicitarConTimeout(conexion, url);
  if (!respuesta.ok) {
    throw Object.assign(
      new Error(`GeoServer respondió ${respuesta.status} al consultar la capa ${capaId}`),
      { status: 502, code: 'GEOSERVER_NO_DISPONIBLE' },
    );
  }
  return respuesta.json();
}

export async function consultarCapa(conexion, capaId, tipo, geometria) {
  if (tipo === 'raster') {
    throw Object.assign(
      new Error('Consulta de capas raster (WPS) pendiente de portar — sin capas raster reales publicadas todavía'),
      { status: 501, code: 'NO_IMPLEMENTADO' },
    );
  }
  return consultarWfs(conexion, capaId, geometria);
}

function extraerBloques(xml, etiqueta) {
  const patron = new RegExp(`<(?:\\w+:)?${etiqueta}\\b[^>]*>[\\s\\S]*?</(?:\\w+:)?${etiqueta}>`, 'g');
  return xml.match(patron) ?? [];
}

function extraerTexto(bloque, etiqueta) {
  const patron = new RegExp(`<(?:\\w+:)?${etiqueta}\\b[^>]*>([^<]*)</(?:\\w+:)?${etiqueta}>`, 'i');
  return bloque.match(patron)?.[1]?.trim() || undefined;
}

/**
 * WFS/WCS GetCapabilities anota el extent geográfico de cada capa como
 * <ows:WGS84BoundingBox><ows:LowerCorner>lon lat</ows:LowerCorner><ows:UpperCorner>lon lat</ows:UpperCorner></ows:WGS84BoundingBox>
 * dentro de cada FeatureType/CoverageSummary -- se usa para ubicar/apuntar hacia la capa en el
 * geovisor sin necesitar un área de interés definida primero.
 */
function extraerBbox(bloque) {
  const [bloqueBbox] = extraerBloques(bloque, 'WGS84BoundingBox');
  if (!bloqueBbox) return undefined;
  const inferior = extraerTexto(bloqueBbox, 'LowerCorner')?.split(/\s+/).map(Number) ?? [];
  const superior = extraerTexto(bloqueBbox, 'UpperCorner')?.split(/\s+/).map(Number) ?? [];
  const oeste = inferior[0] ?? NaN;
  const sur = inferior[1] ?? NaN;
  const este = superior[0] ?? NaN;
  const norte = superior[1] ?? NaN;
  if ([oeste, sur, este, norte].some(Number.isNaN)) return undefined;
  return { oeste, sur, este, norte };
}

/**
 * Descubre las capas vectoriales publicadas en GeoServer vía WFS GetCapabilities — el catálogo de
 * un geovisor consume "todo lo que suban a GeoServer" (filtrado luego por workspace en el
 * servicio), nunca una lista fija en código.
 */
export async function obtenerCapacidadesWfs(conexion) {
  const url = new URL(`${conexion.url}/wfs`);
  url.searchParams.set('service', 'WFS');
  url.searchParams.set('version', '2.0.0');
  url.searchParams.set('request', 'GetCapabilities');

  const respuesta = await solicitarConTimeout(conexion, url);
  if (!respuesta.ok) {
    throw Object.assign(
      new Error(`GeoServer respondió ${respuesta.status} al listar capacidades WFS`),
      { status: 502, code: 'GEOSERVER_NO_DISPONIBLE' },
    );
  }

  const xml = await respuesta.text();
  return extraerBloques(xml, 'FeatureType').flatMap((bloque) => {
    const id = extraerTexto(bloque, 'Name');
    if (!id) return [];
    return [{ id, nombre: extraerTexto(bloque, 'Title') ?? id, tipo: 'vectorial', bbox: extraerBbox(bloque) }];
  });
}

/**
 * Descubre las coberturas raster publicadas vía WCS GetCapabilities. GeoServer expone el
 * CoverageId con "__" en vez de ":" entre workspace y nombre de capa — se normaliza aquí para que
 * el resto del sistema use un único formato de id ("workspace:nombre_capa").
 */
export async function obtenerCapacidadesWcs(conexion) {
  const url = new URL(`${conexion.url}/wcs`);
  url.searchParams.set('service', 'WCS');
  url.searchParams.set('version', '2.0.1');
  url.searchParams.set('request', 'GetCapabilities');

  const respuesta = await solicitarConTimeout(conexion, url);
  if (!respuesta.ok) {
    throw Object.assign(
      new Error(`GeoServer respondió ${respuesta.status} al listar capacidades WCS`),
      { status: 502, code: 'GEOSERVER_NO_DISPONIBLE' },
    );
  }

  const xml = await respuesta.text();
  return extraerBloques(xml, 'CoverageSummary').flatMap((bloque) => {
    const idCrudo = extraerTexto(bloque, 'CoverageId');
    if (!idCrudo) return [];
    const id = idCrudo.replace('__', ':');
    return [{ id, nombre: extraerTexto(bloque, 'Title') ?? id, tipo: 'raster', bbox: extraerBbox(bloque) }];
  });
}

/**
 * Parámetros WMS GetMap que se reenvían tal cual llegan del cliente (Leaflet los arma vía
 * L.tileLayer.wms). Todo lo demás se descarta — nunca se reenvía la solicitud del cliente sin
 * filtrar, para no convertir este proxy en un canal abierto hacia GeoServer.
 */
const PARAMS_WMS_PERMITIDOS = new Set([
  'layers', 'styles', 'format', 'transparent', 'version',
  'width', 'height', 'bbox', 'crs', 'srs', 'exceptions', 'bgcolor',
]);

/**
 * Proxy autenticado de WMS GetMap: el geovisor pinta cada capa con la simbología real definida en
 * GeoServer (SLD publicado) en vez de un esquema inventado en el cliente. El frontend nunca ve la
 * URL ni las credenciales de GeoServer — solo golpea este endpoint.
 *
 * Cuando se recibe `geometriaFiltro` (y se pide una única capa) se recorta la tesela con el mismo
 * criterio espacial que consultarWfs, construido aquí en el backend — nunca con CQL de texto libre
 * del cliente.
 */
export async function proxyWms(conexion, query, geometriaFiltro) {
  const url = new URL(`${conexion.url}/wms`);
  for (const [clave, valor] of query.entries()) {
    if (PARAMS_WMS_PERMITIDOS.has(clave.toLowerCase())) {
      url.searchParams.set(clave, valor);
    }
  }
  url.searchParams.set('service', 'WMS');
  url.searchParams.set('request', 'GetMap');

  const capaSolicitada = url.searchParams.get('layers');
  if (geometriaFiltro && capaSolicitada && !capaSolicitada.includes(',')) {
    const propiedadGeometria = await obtenerNombrePropiedadGeometria(conexion, capaSolicitada);
    const wkt = `SRID=4326;${geometriaAWkt(geometriaFiltro)}`;
    url.searchParams.set('CQL_FILTER', `INTERSECTS(${propiedadGeometria}, ${wkt})`);
  }

  return solicitarConTimeout(conexion, url, undefined);
}

/**
 * Proxy autenticado de WMS GetLegendGraphic: la leyenda que ve el usuario es la que GeoServer
 * genera para el estilo real de la capa (mismos colores/símbolos que proxyWms pintó), no una
 * aproximación.
 */
export async function proxyLeyenda(conexion, capaId) {
  const url = new URL(`${conexion.url}/wms`);
  url.searchParams.set('service', 'WMS');
  url.searchParams.set('version', '1.1.0');
  url.searchParams.set('request', 'GetLegendGraphic');
  url.searchParams.set('layer', capaId);
  url.searchParams.set('format', 'image/png');
  url.searchParams.set('legend_options', 'fontAntiAliasing:true;fontSize:11;forceLabels:on');
  return solicitarConTimeout(conexion, url, undefined);
}
