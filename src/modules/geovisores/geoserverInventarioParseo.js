/**
 * Parseo puro (sin red) de lo que GeoServer publica: WMS 1.3.0 GetCapabilities y las respuestas JSON de la API REST.
 * El XML se lee con un tokenizador propio que NO evalúa nada: rechaza DOCTYPE/entidades, acota los nodos y exige
 * etiquetas bien balanceadas.
 */

export const MAX_NODOS_XML = 200_000;
export const MAX_ELEMENTOS_INVENTARIO = 5_000;
const MAX_PALABRAS_CLAVE = 50;
const MAX_CRS_POR_CAPA = 50;

const errorInventario = (mensaje, code) => Object.assign(new Error(mensaje), { status: 502, code });

const ENTIDADES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
// Una sola pasada: «&amp;lt;» queda «&lt;», no «<».
const decodificar = (texto) => texto.replace(/&(?:#x([0-9a-f]+)|#(\d+)|(amp|lt|gt|quot|apos));/gi, (todo, hex, dec, nombre) => {
  if (nombre) return ENTIDADES[nombre.toLowerCase()];
  const codigo = hex ? parseInt(hex, 16) : Number(dec);
  return Number.isInteger(codigo) && codigo > 0 && codigo <= 0x10ffff ? String.fromCodePoint(codigo) : todo;
});

const sinPrefijo = (nombre) => nombre.split(':').pop();

const TOKEN = /<!--[\s\S]*?-->|<!\[CDATA\[([\s\S]*?)\]\]>|<\?[\s\S]*?\?>|<\/([\w:.-]+)\s*>|<([\w:.-]+)((?:\s+[\w:.-]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>|([^<]+)/y;
const ATRIBUTO = /([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;

function leerAtributos(cadena) {
  const atributos = {};
  for (const [, nombre, doble, simple] of cadena.matchAll(ATRIBUTO)) atributos[sinPrefijo(nombre)] = decodificar(doble ?? simple ?? '');
  return atributos;
}

/** Árbol {nombre, atributos, hijos, texto} sin prefijos de espacio de nombres. */
export function parsearXml(xml) {
  if (typeof xml !== 'string' || /<!DOCTYPE|<!ENTITY/i.test(xml)) {
    throw errorInventario('XML inválido: no se admite DOCTYPE ni entidades', 'XML_INVALIDO');
  }
  const raiz = { nombre: '#raiz', atributos: {}, hijos: [], texto: '' };
  const pila = [raiz];
  let nodos = 0;
  TOKEN.lastIndex = 0;
  while (TOKEN.lastIndex < xml.length) {
    const inicio = TOKEN.lastIndex;
    const m = TOKEN.exec(xml);
    if (!m || TOKEN.lastIndex === inicio) throw errorInventario('XML inválido: contenido no reconocido', 'XML_INVALIDO');
    const [, cdata, cierre, apertura, atributos, autocierre, texto] = m;
    const actual = pila[pila.length - 1];
    if (apertura) {
      nodos += 1;
      if (nodos > MAX_NODOS_XML) throw errorInventario('El XML de GeoServer trae demasiados elementos', 'INVENTARIO_DEMASIADO_GRANDE');
      const nodo = { nombre: sinPrefijo(apertura), atributos: leerAtributos(atributos ?? ''), hijos: [], texto: '' };
      actual.hijos.push(nodo);
      if (!autocierre) pila.push(nodo);
    } else if (cierre) {
      if (pila.length === 1 || actual.nombre !== sinPrefijo(cierre)) throw errorInventario('XML inválido: etiquetas desbalanceadas', 'XML_INVALIDO');
      pila.pop();
    } else if (cdata !== undefined) {
      actual.texto += cdata;
    } else if (texto !== undefined) {
      actual.texto += decodificar(texto);
    }
  }
  if (pila.length !== 1) throw errorInventario('XML inválido: etiquetas sin cerrar', 'XML_INVALIDO');
  return raiz.hijos[0] ?? raiz;
}

const hijosNombrados = (nodo, nombre) => nodo.hijos.filter((h) => h.nombre === nombre);
const hijo = (nodo, nombre) => nodo.hijos.find((h) => h.nombre === nombre);
const textoDe = (nodo, nombre) => hijo(nodo, nombre)?.texto.trim() || undefined;

function bboxDe(nodoCapa) {
  const caja = hijo(nodoCapa, 'EX_GeographicBoundingBox');
  if (!caja) return undefined;
  const [oeste, este, sur, norte] = ['westBoundLongitude', 'eastBoundLongitude', 'southBoundLatitude', 'northBoundLatitude']
    .map((nombre) => Number(textoDe(caja, nombre)));
  return [oeste, este, sur, norte].every(Number.isFinite) ? { oeste, sur, este, norte } : undefined;
}

function estilosDe(nodoCapa) {
  return hijosNombrados(nodoCapa, 'Style').flatMap((estilo) => {
    const nombre = textoDe(estilo, 'Name');
    if (!nombre) return [];
    const recurso = hijo(hijo(estilo, 'LegendURL') ?? { hijos: [] }, 'OnlineResource');
    return [{ nombre, leyendaUrl: recurso?.atributos.href || undefined }];
  });
}

const capasHijas = (nodo) => hijosNombrados(nodo, 'Layer');
const tieneNombre = (nodo) => Boolean(textoDe(nodo, 'Name'));

// Una carpeta sin Name no es capa ni grupo, pero lo que contiene sí cuenta como miembro de quien la contiene.
function miembrosNombrados(nodo) {
  return capasHijas(nodo).flatMap((h) => (tieneNombre(h) ? [h] : miembrosNombrados(h)));
}

const esGrupo = (nodo) => miembrosNombrados(nodo).length > 0;

function unirUnicos(...listas) {
  return [...new Set(listas.flat())].slice(0, MAX_CRS_POR_CAPA);
}

/**
 * Capas y grupos de un WMS 1.3.0 GetCapabilities. Un grupo es una capa con nombre que contiene capas con nombre;
 * una misma capa puede colgar de varios grupos y se registra una sola vez.
 */
export function parsearCapacidadesWms(xml) {
  const raiz = parsearXml(xml);
  const capas = new Map();
  const grupos = new Map();

  const visitar = (nodo, crsHeredados) => {
    const crs = unirUnicos(crsHeredados, hijosNombrados(nodo, 'CRS').map((c) => c.texto.trim()).filter(Boolean));
    const id = textoDe(nodo, 'Name');
    if (id && !capas.has(id) && !grupos.has(id)) {
      const base = { id, titulo: textoDe(nodo, 'Title'), resumen: textoDe(nodo, 'Abstract'), bbox: bboxDe(nodo) };
      if (esGrupo(nodo)) {
        grupos.set(id, { ...base, miembros: miembrosNombrados(nodo).map((m) => ({ tipo: esGrupo(m) ? 'grupo' : 'capa', id: textoDe(m, 'Name') })) });
      } else {
        const estilos = estilosDe(nodo);
        capas.set(id, {
          ...base,
          palabrasClave: hijosNombrados(hijo(nodo, 'KeywordList') ?? { hijos: [] }, 'Keyword').map((k) => k.texto.trim()).filter(Boolean).slice(0, MAX_PALABRAS_CLAVE),
          crs,
          estilos,
          estiloDefecto: estilos[0]?.nombre,
        });
      }
      if (capas.size + grupos.size > MAX_ELEMENTOS_INVENTARIO) {
        throw errorInventario('GeoServer publica más elementos de los que admite el inventario', 'INVENTARIO_DEMASIADO_GRANDE');
      }
    }
    capasHijas(nodo).forEach((h) => visitar(h, crs));
  };

  const capability = raiz.nombre === 'Capability' ? raiz : hijo(raiz, 'Capability');
  (capability ? capasHijas(capability) : []).forEach((h) => visitar(h, []));
  return { capas: [...capas.values()], grupos: [...grupos.values()] };
}

const SUFIJO_SERVICIO = /\/(wms|wfs|wcs|ows)$/i;

/** URL de la conexión sin el sufijo de servicio ni la barra final: «…/geoserver». */
export function derivarBaseOgc(urlConexion) {
  const url = new URL(urlConexion);
  const ruta = url.pathname.replace(/\/+$/, '').replace(SUFIJO_SERVICIO, '');
  return `${url.origin}${ruta}`;
}

/** Base de la API REST: «…/geoserver/rest». */
export function derivarBaseRest(urlConexion) {
  return `${derivarBaseOgc(urlConexion)}/rest`;
}

/** La REST devuelve "" cuando no hay elementos, un objeto cuando hay uno y un arreglo cuando hay varios. */
export function listaRest(valor) {
  if (Array.isArray(valor)) return valor;
  return valor && typeof valor === 'object' ? [valor] : [];
}

/** Detalle de un grupo de la REST → forma del inventario; null si no trae nombre. */
export function parsearGrupoRest(detalle) {
  const grupo = detalle?.layerGroup;
  const nombre = grupo?.name;
  if (!nombre) return null;
  const espacio = grupo.workspace?.name ?? null;
  const miembros = listaRest(grupo.publishables?.published).flatMap((p) => (p?.name
    ? [{ tipo: p['@type'] === 'layerGroup' ? 'grupo' : 'capa', id: p.name }]
    : []));
  return {
    id: espacio && !nombre.includes(':') ? `${espacio}:${nombre}` : nombre,
    espacio,
    nombre: nombre.includes(':') ? nombre.split(':').pop() : nombre,
    titulo: grupo.title || null,
    resumen: grupo.abstractTxt || null,
    modo: grupo.mode || null,
    miembros,
  };
}
