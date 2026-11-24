/**
 * geoserver.connector — Portado desde producto6-reportes-vigia (prototipo aceptado) a
 * VIGIIAP-backend como módulo nativo. Diferencia clave respecto al original: cada función recibe
 * una `conexion` ({ id, url, usuarioLectura, passwordDescifrada, timeoutMs }) en vez de leer
 * env.GEOSERVER_* fijas -- soporta más de un servidor GeoServer (tabla `conexiones_geoserver`)
 * sin cambiar código, como se acordó en docs/PORTAL_GEOVISORES_DISENO.md § 1.
 * Desde la migración 047 también soporta conexiones "externas" (WMS/WFS de
 * terceros) sin credenciales -- Authorization solo se manda cuando la conexión
 * las tiene, este módulo no necesita saber si el tipo es propio o externo.
 */
import { TextDecoder } from 'node:util';
import { Agent } from 'undici';
import { geometriaAWkt } from '../../utils/geometry.js';
import { dnsLookupSeguro } from '../../utils/ssrfGuard.js';
import logger from '../../utils/logger.js';
import { validarCapaId } from './capaId.js';
import {
  parsearCapacidadesWms, parsearGrupoRest, derivarBaseOgc, derivarBaseRest, listaRest,
} from './geoserverInventarioParseo.js';

const MAX_REINTENTOS = 1;
const INTERVALO_AVISO_CREDENCIALES_MS = 60_000;

// La consulta por geometría es pública: sin tope, un polígono sobre todo el territorio vuelca la capa
// entera (con todos sus atributos) y la respuesta se bufferiza en memoria.
export const MAX_FEATURES_CONSULTA = 200;
export const MAX_BYTES_CONSULTA = 5 * 1024 * 1024;

function credencialesBasicAuth(conexion) {
  const credenciales = `${conexion.usuarioLectura}:${conexion.passwordDescifrada}`;
  return Buffer.from(credenciales).toString('base64');
}

const tieneCredenciales = (conexion) => Boolean(conexion.usuarioLectura && conexion.passwordDescifrada);

const ultimoAvisoCredenciales = new Map(); // clave: conexion.id

// Una clave mal guardada hace fallar cada petición: se avisa una vez por minuto, no en cada una.
function avisarCredencialesRechazadas(conexion, estado) {
  const ahora = Date.now();
  if (ahora - (ultimoAvisoCredenciales.get(conexion.id) ?? 0) < INTERVALO_AVISO_CREDENCIALES_MS) return;
  ultimoAvisoCredenciales.set(conexion.id, ahora);
  logger.warn(`[geoserver] ${estado} rechazó las credenciales de la conexión ${conexion.id}: se atiende sin credenciales. Revisa el usuario y la clave de la conexión.`);
}

// Agent propio con una resolución DNS fijada a dnsLookupSeguro -- sin esto,
// ssrfGuard valida una resolución DNS y fetch() hace la SUYA por separado
// para conectar; dos consultas al mismo resolver (controlado por el dueño
// del dominio) pueden responder cosas distintas (DNS rebinding). Con este
// Agent, la resolución que valida "no es una IP privada" y la resolución que
// el socket usa para conectar son literalmente la misma llamada.
const agenteSsrfSeguro = new Agent({ connect: { lookup: dnsLookupSeguro } });

/**
 * `credenciales`: 'auto' (por defecto) manda las de la conexión y, si GeoServer las rechaza con 401/403, repite UNA vez
 * sin ellas -- lo público sigue sirviéndose aunque la clave guardada esté mal; 'estricto' las manda sin reintentar
 * (para comprobarlas); 'ninguna' no manda Authorization.
 */
async function solicitarConTimeout(conexion, url, aceptar = 'application/json', intento = 0, credenciales = 'auto') {
  const controlador = new AbortController();
  const temporizador = setTimeout(() => controlador.abort(), conexion.timeoutMs);

  try {
    const respuesta = await fetch(url, {
      signal: controlador.signal,
      dispatcher: agenteSsrfSeguro,
      // 'manual': una respuesta 3xx del GeoServer configurado no se sigue
      // nunca automáticamente. ssrfGuard solo valida la URL original de la
      // conexión — seguir una redirección significa conectarse a una
      // dirección que nunca pasó por ese chequeo (p.ej. 169.254.169.254).
      // Ninguna operación WMS/WFS/WCS legítima necesita redirigir.
      redirect: 'manual',
      headers: {
        ...(credenciales !== 'ninguna' && tieneCredenciales(conexion)
          ? { Authorization: `Basic ${credencialesBasicAuth(conexion)}` }
          : {}),
        ...(aceptar ? { Accept: aceptar } : {}),
      },
    });

    if (respuesta.type === 'opaqueredirect' || (respuesta.status >= 300 && respuesta.status < 400)) {
      throw Object.assign(
        new Error('GeoServer devolvió una redirección — no se sigue por seguridad'),
        { status: 502, code: 'GEOSERVER_REDIRECT_RECHAZADO' },
      );
    }

    if (credenciales === 'auto' && (respuesta.status === 401 || respuesta.status === 403) && tieneCredenciales(conexion)) {
      avisarCredencialesRechazadas(conexion, respuesta.status);
      return solicitarConTimeout(conexion, url, aceptar, intento, 'ninguna');
    }

    if (!respuesta.ok && respuesta.status >= 500 && intento < MAX_REINTENTOS) {
      return solicitarConTimeout(conexion, url, aceptar, intento + 1, credenciales);
    }

    return respuesta;
  } catch (error) {
    // Un rechazo explícito por redirección nunca se reintenta ni se
    // reempaca como "no disponible" — reintentar no cambia el hecho de
    // que la respuesta fue una redirección fuera del dominio ya validado.
    if (error.code === 'GEOSERVER_REDIRECT_RECHAZADO') throw error;
    if (intento < MAX_REINTENTOS) {
      return solicitarConTimeout(conexion, url, aceptar, intento + 1, credenciales);
    }
    // undici esconde el motivo real (ECONNRESET, timeout, DNS...) en error.cause.
    const detalle = error.cause?.code ?? error.cause?.message;
    throw Object.assign(
      new Error(`GeoServer no respondió a tiempo o no está disponible: ${error.message}${detalle ? ` (${detalle})` : ''}`),
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
  validarCapaId(capaId);
  const wkt = `SRID=4326;${geometriaAWkt(geometria)}`;
  const propiedadGeometria = await obtenerNombrePropiedadGeometria(conexion, capaId);

  const url = new URL(`${conexion.url}/wfs`);
  url.searchParams.set('service', 'WFS');
  url.searchParams.set('version', '2.0.0');
  url.searchParams.set('request', 'GetFeature');
  url.searchParams.set('typeNames', capaId);
  url.searchParams.set('outputFormat', 'application/json');
  url.searchParams.set('srsName', 'EPSG:4326');
  url.searchParams.set('count', String(MAX_FEATURES_CONSULTA));
  url.searchParams.set('CQL_FILTER', `INTERSECTS(${propiedadGeometria}, ${wkt})`);

  const respuesta = await solicitarConTimeout(conexion, url);
  if (!respuesta.ok) {
    throw Object.assign(
      new Error(`GeoServer respondió ${respuesta.status} al consultar la capa ${capaId}`),
      { status: 502, code: 'GEOSERVER_NO_DISPONIBLE' },
    );
  }
  const bytes = Number(respuesta.headers?.get?.('content-length'));
  if (Number.isFinite(bytes) && bytes > MAX_BYTES_CONSULTA) {
    throw Object.assign(
      new Error('La consulta devuelve demasiados datos. Reduce el área consultada.'),
      { status: 413, code: 'CONSULTA_DEMASIADO_GRANDE' },
    );
  }
  return respuesta.json();
}

/**
 * Atributos reales de una capa (nombre + tipo XSD), vía el mismo WFS
 * DescribeFeatureType que ya resuelve la columna de geometría -- se excluyen
 * las columnas de tipo gml:*PropertyType (geometría), que no sirven como
 * identificador ni etiqueta de una ficha por punto.
 */
export async function obtenerAtributosCapa(conexion, capaId) {
  validarCapaId(capaId);
  const url = new URL(`${conexion.url}/wfs`);
  url.searchParams.set('service', 'WFS');
  url.searchParams.set('version', '2.0.0');
  url.searchParams.set('request', 'DescribeFeatureType');
  url.searchParams.set('typeNames', capaId);

  const respuesta = await solicitarConTimeout(conexion, url);
  if (!respuesta.ok) {
    throw Object.assign(
      new Error(`GeoServer respondió ${respuesta.status} al describir la capa ${capaId}`),
      { status: 502, code: 'GEOSERVER_NO_DISPONIBLE' },
    );
  }

  const xml = await respuesta.text();
  const elementos = xml.match(/<xsd:element\b[^>]*\/>/g) ?? [];
  return elementos.flatMap((elemento) => {
    const nombre = elemento.match(/\bname="([^"]*)"/)?.[1];
    const tipo = elemento.match(/\btype="([^"]*)"/)?.[1] ?? '';
    if (!nombre || tipo.startsWith('gml:')) return [];
    return [{ nombre, tipo }];
  });
}

/**
 * Conteo barato de features de una capa (WFS GetFeature con resultType=hits,
 * sin traer ninguna fila) -- usado para rechazar capas demasiado grandes
 * (>2000 features, ver LIMITE_FEATURES en fichas.service.js) antes de pedir
 * el listado completo.
 *
 * Varias versiones de GeoServer (confirmado contra geo.siatpc.co en
 * producción) IGNORAN outputFormat=application/json cuando resultType=hits y
 * siempre devuelven la respuesta WFS 2.0 estándar en XML, con el conteo en el
 * atributo numberMatched del elemento raíz -- nunca se puede asumir que la
 * respuesta sea JSON solo porque se pidió.
 */
export async function contarFeaturesCapa(conexion, capaId) {
  validarCapaId(capaId);
  const url = new URL(`${conexion.url}/wfs`);
  url.searchParams.set('service', 'WFS');
  url.searchParams.set('version', '2.0.0');
  url.searchParams.set('request', 'GetFeature');
  url.searchParams.set('typeNames', capaId);
  url.searchParams.set('resultType', 'hits');
  url.searchParams.set('outputFormat', 'application/json');

  const respuesta = await solicitarConTimeout(conexion, url, 'application/json, text/xml, application/xml');
  if (!respuesta.ok) {
    throw Object.assign(
      new Error(`GeoServer respondió ${respuesta.status} al contar features de ${capaId}`),
      { status: 502, code: 'GEOSERVER_NO_DISPONIBLE' },
    );
  }
  const texto = await respuesta.text();
  if (texto.trimStart().startsWith('{')) {
    return JSON.parse(texto).totalFeatures ?? 0;
  }
  const numberMatched = texto.match(/\bnumberMatched="(\d+)"/)?.[1];
  return numberMatched ? Number(numberMatched) : 0;
}

/**
 * WFS GetFeature restringido a un subconjunto de propiedades (identificador +
 * etiqueta opcional) más geometría -- para el listado de completitud de
 * fichas por punto, que nunca debe traer los atributos completos de cada
 * feature (potencialmente cientos), solo lo mínimo para identificar el punto
 * y calcular su centroide.
 *
 * La columna de geometría SIEMPRE se agrega al propertyName -- sin ella,
 * GeoServer devuelve cada feature con geometry:null (propertyName es una
 * lista exacta, no un "además de la geometría" implícito). Verificado
 * contra geo.siatpc.co en producción: sin esto, ninguna ficha tendría
 * centroide para el mini-mapa del checklist admin.
 */
/**
 * GeoServer responde 400 cuando propertyName pide un campo que la capa ya no tiene (p. ej. se
 * renombró o se quitó la columna que la ficha usa como identificador). Se convierte en un error
 * accionable que dice cuál campo falla y cuáles hay, en vez de un genérico "respondió 400".
 */
function errorDeCampoInexistente(cuerpo, capaId) {
  const coincidencia = cuerpo.match(/Requested property:\s*(.+?) is not available[^[]*(?:\[([^\]]*)\])?/s);
  if (!coincidencia) return null;
  const [, campo, disponibles] = coincidencia;
  const lista = disponibles ? ` Campos disponibles: ${disponibles.trim()}.` : '';
  return Object.assign(
    new Error(`El campo "${campo.trim()}" configurado para fichas ya no existe en la capa ${capaId}.${lista} Actualiza la configuración de fichas de la capa.`),
    { status: 422, code: 'CAMPO_FICHAS_INEXISTENTE' },
  );
}

export async function listarFeaturesCapa(conexion, capaId, campoIdentificador, campoEtiqueta) {
  validarCapaId(capaId);
  const propiedadGeometria = await obtenerNombrePropiedadGeometria(conexion, capaId);
  const propiedades = [campoIdentificador, campoEtiqueta, propiedadGeometria].filter(Boolean).join(',');

  const url = new URL(`${conexion.url}/wfs`);
  url.searchParams.set('service', 'WFS');
  url.searchParams.set('version', '2.0.0');
  url.searchParams.set('request', 'GetFeature');
  url.searchParams.set('typeNames', capaId);
  url.searchParams.set('outputFormat', 'application/json');
  url.searchParams.set('srsName', 'EPSG:4326');
  url.searchParams.set('propertyName', propiedades);

  const respuesta = await solicitarConTimeout(conexion, url);
  if (!respuesta.ok) {
    if (respuesta.status === 400) {
      const errorCampo = errorDeCampoInexistente(await respuesta.text().catch(() => ''), capaId);
      if (errorCampo) throw errorCampo;
    }
    throw Object.assign(
      new Error(`GeoServer respondió ${respuesta.status} al listar features de ${capaId}`),
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
 * Prueba las credenciales de la conexión tal cual (sin el reintento anónimo): devuelve el estado HTTP que da GeoServer
 * a un WFS GetCapabilities. Sirve para rechazar al guardar una clave que GeoServer no acepta.
 */
export async function probarCredenciales(conexion) {
  const url = new URL(`${conexion.url}/wfs`);
  url.searchParams.set('service', 'WFS');
  url.searchParams.set('version', '2.0.0');
  url.searchParams.set('request', 'GetCapabilities');
  const respuesta = await solicitarConTimeout(conexion, url, 'application/json', 0, 'estricto');
  return respuesta.status;
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

// ─── Inventario (solo lectura): WMS GetCapabilities + API REST ───────────────────────────────────────────────────
export const MAX_BYTES_INVENTARIO = 10 * 1024 * 1024;
export const MAX_ESPACIOS = 500;
export const MAX_GRUPOS = 2_000;
export const MAX_ESTILOS = 5_000;
const CONCURRENCIA_REST = 4;
const ESTADOS_REST_TOLERADOS = [403, 404];

const errorGeoserver = (mensaje, code, status = 502) => Object.assign(new Error(mensaje), { status, code });

function exigirPlazo(venceEn) {
  if (venceEn && Date.now() > venceEn) throw errorGeoserver('Se agotó el tiempo de la sincronización', 'INVENTARIO_TIEMPO_AGOTADO', 504);
}

/** Lee el cuerpo sin pasar de `maxBytes`: una respuesta desmedida se corta en vez de bufferizarse entera. */
async function leerCuerpoAcotado(respuesta, maxBytes = MAX_BYTES_INVENTARIO) {
  const demasiado = () => errorGeoserver('GeoServer devolvió una respuesta demasiado grande', 'INVENTARIO_DEMASIADO_GRANDE');
  const declarado = Number(respuesta.headers?.get?.('content-length'));
  if (Number.isFinite(declarado) && declarado > maxBytes) throw demasiado();
  if (!respuesta.body?.getReader) {
    const texto = await respuesta.text();
    if (texto.length > maxBytes) throw demasiado();
    return texto;
  }
  const lector = respuesta.body.getReader();
  const decodificador = new TextDecoder();
  let total = 0;
  let texto = '';
  for (;;) {
    const { done, value } = await lector.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await lector.cancel().catch(() => {});
      throw demasiado();
    }
    texto += decodificador.decode(value, { stream: true });
  }
  return texto + decodificador.decode();
}

/**
 * WMS 1.3.0 GetCapabilities: capas con título, resumen, palabras clave, bbox, CRS y estilos, y los grupos de capas
 * (capas con capas anidadas) con sus miembros en orden. La ruta se arma desde la base del servidor, no se duplica «/wms».
 */
export async function obtenerCapacidadesWms(conexion, { venceEn } = {}) {
  exigirPlazo(venceEn);
  const url = new URL(`${derivarBaseOgc(conexion.url)}/wms`);
  url.searchParams.set('service', 'WMS');
  url.searchParams.set('version', '1.3.0');
  url.searchParams.set('request', 'GetCapabilities');

  const respuesta = await solicitarConTimeout(conexion, url, 'text/xml, application/xml');
  if (!respuesta.ok) throw errorGeoserver(`GeoServer respondió ${respuesta.status} al listar capacidades WMS`, 'GEOSERVER_NO_DISPONIBLE');
  return parsearCapacidadesWms(await leerCuerpoAcotado(respuesta));
}

/**
 * GET de la API REST. 401/403/404 en un recurso que no se tolera significa «no hay REST con estas credenciales»
 * (code GEOSERVER_REST_NO_DISPONIBLE); en uno tolerado devuelve null.
 */
async function obtenerJsonRest(conexion, ruta, { venceEn, toleradas = [] } = {}) {
  exigirPlazo(venceEn);
  const respuesta = await solicitarConTimeout(conexion, new URL(`${derivarBaseRest(conexion.url)}${ruta}`));
  if (toleradas.includes(respuesta.status)) return null;
  if ([401, 403, 404].includes(respuesta.status)) {
    throw errorGeoserver(`La API REST de GeoServer respondió ${respuesta.status}`, 'GEOSERVER_REST_NO_DISPONIBLE', respuesta.status);
  }
  if (!respuesta.ok) throw errorGeoserver(`GeoServer respondió ${respuesta.status} en la API REST`, 'GEOSERVER_NO_DISPONIBLE');
  try {
    return JSON.parse(await leerCuerpoAcotado(respuesta));
  } catch (error) {
    if (error.code) throw error;
    throw errorGeoserver('La API REST de GeoServer devolvió JSON inválido', 'RESPUESTA_REST_INVALIDA');
  }
}

async function mapearConLimite(elementos, funcion, limite = CONCURRENCIA_REST) {
  const resultados = new Array(elementos.length);
  let siguiente = 0;
  const trabajador = async () => {
    while (siguiente < elementos.length) {
      const indice = siguiente;
      siguiente += 1;
      resultados[indice] = await funcion(elementos[indice]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limite, elementos.length) }, trabajador));
  return resultados;
}

const codificar = encodeURIComponent;
const acotar = (lista, maximo, que) => {
  if (lista.length > maximo) throw errorGeoserver(`GeoServer publica más ${que} de los que admite el inventario`, 'INVENTARIO_DEMASIADO_GRANDE');
  return lista;
};

/** El ámbito global y uno por espacio de trabajo: cada uno cuelga de una ruta base distinta de la REST. */
const ambitosRest = (nombresEspacios) => [
  { espacio: null, base: '' },
  ...nombresEspacios.map((espacio) => ({ espacio, base: `/workspaces/${codificar(espacio)}` })),
];

/** Nombres de los espacios de trabajo según la REST. */
async function nombresDeEspacios(conexion, opciones) {
  const json = await obtenerJsonRest(conexion, '/workspaces.json', opciones);
  return acotar(listaRest(json?.workspaces?.workspace).map((w) => w.name).filter(Boolean), MAX_ESPACIOS, 'espacios de trabajo');
}

/**
 * Espacios de trabajo con su URI de espacio de nombres y, si el administrador los configuró, el título y el resumen de
 * los ajustes del servicio WMS del espacio (los espacios no tienen título propio en GeoServer).
 */
export async function listarEspaciosRest(conexion, { venceEn } = {}) {
  const nombres = await nombresDeEspacios(conexion, { venceEn });
  const tolerar = { venceEn, toleradas: ESTADOS_REST_TOLERADOS };
  return mapearConLimite(nombres, async (nombre) => {
    const [ns, ajustes] = await Promise.all([
      obtenerJsonRest(conexion, `/namespaces/${codificar(nombre)}.json`, tolerar),
      obtenerJsonRest(conexion, `/services/wms/workspaces/${codificar(nombre)}/settings.json`, tolerar),
    ]);
    return {
      nombre,
      namespaceUri: ns?.namespace?.uri ?? null,
      aislado: ns?.namespace?.isolated === true,
      tituloServicio: ajustes?.wms?.title || null,
      resumenServicio: ajustes?.wms?.abstrct || ajustes?.wms?.abstract || null,
    };
  });
}

/** Grupos globales y por espacio, con miembros ordenados y modo (detalle de cada grupo). */
export async function listarGruposRest(conexion, { espacios, venceEn } = {}) {
  const nombresEspacios = espacios ?? await nombresDeEspacios(conexion, { venceEn });
  const tolerar = { venceEn, toleradas: ESTADOS_REST_TOLERADOS };
  const ambitos = ambitosRest(nombresEspacios);
  const listados = await mapearConLimite(ambitos, async ({ espacio, base }) => {
    const json = await obtenerJsonRest(conexion, `${base}/layergroups.json`, espacio ? tolerar : { venceEn });
    return listaRest(json?.layerGroups?.layerGroup).filter((g) => g.name).map((g) => ({ base, nombre: g.name }));
  });
  const grupos = acotar(listados.flat(), MAX_GRUPOS, 'grupos de capas');
  const detalles = await mapearConLimite(grupos, async ({ base, nombre }) => (
    parsearGrupoRest(await obtenerJsonRest(conexion, `${base}/layergroups/${codificar(nombre)}.json`, tolerar))
  ));
  return detalles.filter(Boolean);
}

/** Estilos globales y por espacio (solo nombre y espacio: el formato exigiría una petición por estilo). */
export async function listarEstilosRest(conexion, { espacios, venceEn } = {}) {
  const nombresEspacios = espacios ?? await nombresDeEspacios(conexion, { venceEn });
  const tolerar = { venceEn, toleradas: ESTADOS_REST_TOLERADOS };
  const ambitos = ambitosRest(nombresEspacios);
  const listados = await mapearConLimite(ambitos, async ({ espacio, base }) => {
    const json = await obtenerJsonRest(conexion, `${base}/styles.json`, espacio ? tolerar : { venceEn });
    return listaRest(json?.styles?.style).filter((e) => e.name).map((e) => ({ nombre: e.name, espacio }));
  });
  return acotar(listados.flat(), MAX_ESTILOS, 'estilos');
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
  validarCapaId(capaId);
  const url = new URL(`${conexion.url}/wms`);
  url.searchParams.set('service', 'WMS');
  url.searchParams.set('version', '1.1.0');
  url.searchParams.set('request', 'GetLegendGraphic');
  url.searchParams.set('layer', capaId);
  url.searchParams.set('format', 'image/png');
  url.searchParams.set('legend_options', 'fontAntiAliasing:true;fontSize:11;forceLabels:on');
  return solicitarConTimeout(conexion, url, undefined);
}
