/**
 * ssrfGuard — bloquea que una URL de conexión GeoServer (o cualquier otro
 * origen externo configurable por un admin) apunte a una red interna/privada.
 *
 * Contexto: el proxy WMS/WFS/WCS hacia GeoServer (geoserver.connector.js)
 * hace fetch() desde el propio backend usando la URL guardada en
 * conexiones_geoserver.url. Esa URL solo la puede fijar super_admin, pero
 * si esa cuenta se ve comprometida (o alguien la eleva a un rol más bajo en
 * el futuro), apuntarla a una IP interna convertiría el proxy en un canal
 * SSRF hacia la red del VPS (ej. metadata de nube, servicios internos).
 *
 * Se resuelve el hostname (no basta con mirar el string -- un dominio
 * público puede apuntar a una IP privada, DNS rebinding) y se verifica CADA
 * dirección resuelta contra los rangos reservados/privados de IPv4 e IPv6,
 * well-known (RFC 1918, RFC 5735, RFC 4291 §2.5.6/§2.5.7).
 *
 * El chequeo en sí usa net.BlockList (Node >=15) en vez de comparar texto o
 * hacer aritmética de bits a mano: una misma dirección IPv6 tiene varias
 * formas textuales válidas (ej. "::1" y "0:0:0:0:0:0:0:1" son la misma
 * dirección) -- BlockList.check() normaliza correctamente antes de comparar,
 * una comparación por string/regex no.
 */
import dns from 'node:dns/promises';
import net from 'node:net';

const RANGOS_IPV4_PRIVADOS = [
  ['0.0.0.0', 8],      // "esta" red
  ['10.0.0.0', 8],     // RFC 1918
  ['100.64.0.0', 10],  // NAT de operador (RFC 6598)
  ['127.0.0.0', 8],    // loopback
  ['169.254.0.0', 16], // link-local -- incluye metadata de nube (169.254.169.254)
  ['172.16.0.0', 12],  // RFC 1918
  ['192.0.0.0', 24],   // asignaciones IETF
  ['192.168.0.0', 16], // RFC 1918
  ['198.18.0.0', 15],  // benchmarking
  ['224.0.0.0', 4],    // multicast
  ['240.0.0.0', 4],    // reservado
];

const RANGOS_IPV6_PRIVADOS = [
  ['::1', 128],   // loopback
  ['::', 128],    // no especificada
  ['fe80::', 10], // link-local
  ['fc00::', 7],  // unique local (RFC 4193)
  // OJO: NO se agrega ::ffff:0:0/96 acá -- BlockList representa toda
  // dirección IPv4 internamente como su forma mapeada ::ffff:a.b.c.d para
  // comparar, así que una subred /96 sobre ::ffff:0:0 agregada con family
  // 'ipv6' termina emparejando CUALQUIER chequeo family 'ipv4' (bloquea
  // 8.8.8.8, confirmado con un check directo). El caso IPv4-mapped se
  // maneja aparte, extrayendo la IPv4 embebida (ver RE_IPV4_MAPEADA* abajo)
  // y evaluándola contra RANGOS_IPV4_PRIVADOS normalmente.
];

const listaBloqueo = new net.BlockList();
for (const [base, prefijo] of RANGOS_IPV4_PRIVADOS) listaBloqueo.addSubnet(base, prefijo, 'ipv4');
for (const [base, prefijo] of RANGOS_IPV6_PRIVADOS) listaBloqueo.addSubnet(base, prefijo, 'ipv6');

// IPv4-mapped (::ffff:a.b.c.d o su forma hex ::ffff:c0a8:0101) -- Node no
// expande esta forma al chequear contra un rango IPv6 con BlockList, así que
// se detecta el patrón y se evalúa la IPv4 embebida aparte, vía BlockList
// también (subred /96 sobre ::ffff:0:0 ya cubre la detección del PATRÓN;
// esto solo extrae el valor para chequearlo contra los rangos IPv4).
const RE_IPV4_MAPEADA = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i;
const RE_IPV4_MAPEADA_HEX = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i;

function ipv4DesdeHex(altoHex, bajoHex) {
  const alto = parseInt(altoHex, 16);
  const bajo = parseInt(bajoHex, 16);
  return [alto >> 8, alto & 0xff, bajo >> 8, bajo & 0xff].join('.');
}

function esDireccionPrivada(ip) {
  if (net.isIPv4(ip)) return listaBloqueo.check(ip, 'ipv4');
  if (net.isIPv6(ip)) {
    if (listaBloqueo.check(ip, 'ipv6')) return true;
    const normalizada = ip.toLowerCase();
    const mapeada = normalizada.match(RE_IPV4_MAPEADA);
    if (mapeada) return listaBloqueo.check(mapeada[1], 'ipv4');
    const mapeadaHex = normalizada.match(RE_IPV4_MAPEADA_HEX);
    if (mapeadaHex) return listaBloqueo.check(ipv4DesdeHex(mapeadaHex[1], mapeadaHex[2]), 'ipv4');
    return false;
  }
  return false;
}

async function resolverYEvaluar(hostname) {
  if (net.isIP(hostname)) return esDireccionPrivada(hostname);
  try {
    const direcciones = await dns.lookup(hostname, { all: true, verbatim: true });
    return direcciones.some((d) => esDireccionPrivada(d.address));
  } catch {
    // La resolución falla acá (dominio inexistente, timeout) -- no bloquea:
    // la petición real de geoserver.connector.js también fallaría por lo
    // mismo, esto no es una guarda de disponibilidad, es una guarda de
    // destino. Con TTL corto (ver caché abajo) un fallo transitorio se
    // vuelve a evaluar pronto, no queda "permitido" de forma permanente.
    return false;
  }
}

// TTL corto -- esta misma función se llama en dos momentos distintos:
// 1) al crear/editar la conexión (una vez).
// 2) en obtenerConexionParaConector(), justo antes de CADA petición real del
//    proxy (ver conexionesGeoserver.service.js) -- ahí es donde importa de
//    verdad: sin una revalidación periódica, un dominio que resuelve a IP
//    pública al aprobarse la conexión y luego cambia su DNS hacia una IP
//    interna (DNS rebinding) quedaría confiado indefinidamente. El caché
//    evita hacer una resolución DNS en cada tile (decenas por pan/zoom del
//    mapa) sin reabrir esa ventana más de lo necesario.
const TTL_CACHE_MS = 5 * 60 * 1000;
const cache = new Map(); // hostname -> { privada, expira }

/**
 * true si la URL apunta (directamente o vía resolución DNS) a una red
 * privada/reservada.
 */
export async function urlApuntaARedPrivada(urlString) {
  let hostname;
  try {
    // URL#hostname conserva los corchetes en un literal IPv6 (ej. "[::1]") --
    // net.isIP()/net.isIPv6() no los reconocen con corchetes.
    hostname = new URL(urlString).hostname.replace(/^\[|\]$/g, '');
  } catch {
    return false; // formato inválido -- lo rechaza z.string().url(), no esta guarda
  }

  const ahora = Date.now();
  const cacheada = cache.get(hostname);
  if (cacheada && cacheada.expira > ahora) return cacheada.privada;

  const privada = await resolverYEvaluar(hostname);
  cache.set(hostname, { privada, expira: ahora + TTL_CACHE_MS });
  return privada;
}
