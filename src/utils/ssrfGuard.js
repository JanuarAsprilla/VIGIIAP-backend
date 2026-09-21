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
 * público puede apuntar a una IP privada, DNS rebinding) y se verifica
 * CADA dirección resuelta contra los rangos reservados/privados de
 * IPv4 e IPv6. No requiere una librería aparte: son un puñado de rangos
 * fijos, well-known (RFC 1918, RFC 5735, RFC 4291 §2.5.6/§2.5.7).
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

function ipv4ANumero(ip) {
  return ip.split('.').reduce((acc, octeto) => (acc << 8) + Number(octeto), 0) >>> 0;
}

function esIpv4Privada(ip) {
  const num = ipv4ANumero(ip);
  return RANGOS_IPV4_PRIVADOS.some(([base, prefijo]) => {
    const mascara = prefijo === 0 ? 0 : (0xffffffff << (32 - prefijo)) >>> 0;
    return (num & mascara) === (ipv4ANumero(base) & mascara);
  });
}

function esIpv6Privada(ip) {
  const normalizada = ip.toLowerCase();
  if (normalizada === '::1') return true;                     // loopback
  if (normalizada.startsWith('fe80:')) return true;            // link-local
  if (/^f[cd][0-9a-f]{2}:/.test(normalizada)) return true;     // unique local (fc00::/7)
  // IPv4-mapped (::ffff:a.b.c.d) -- se evalúa la IPv4 embebida.
  const mapeada = normalizada.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapeada) return esIpv4Privada(mapeada[1]);
  return false;
}

function esDireccionPrivada(ip) {
  if (net.isIPv4(ip)) return esIpv4Privada(ip);
  if (net.isIPv6(ip)) return esIpv6Privada(ip);
  return false;
}

/**
 * true si la URL apunta (directamente o vía resolución DNS) a una red
 * privada/reservada. Si la resolución DNS falla (dominio inexistente,
 * timeout), se deja pasar -- lo bloquea igual la petición real de
 * geoserver.connector.js al no poder conectar, y esto no es una guarda de
 * disponibilidad, es una guarda de destino.
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

  if (net.isIP(hostname)) return esDireccionPrivada(hostname);

  try {
    const direcciones = await dns.lookup(hostname, { all: true, verbatim: true });
    return direcciones.some((d) => esDireccionPrivada(d.address));
  } catch {
    return false;
  }
}
