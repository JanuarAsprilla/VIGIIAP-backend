import { createRequire } from 'node:module';
import logger from './logger.js';

/**
 * Ubicación aproximada de una IP con una base local (sin consultar servicios externos: la IP
 * del visitante no sale del servidor). El proveedor concreto queda detrás de `ubicarIp`, así
 * que cambiarlo (otra base, otro paquete) no toca a quien lo usa.
 */

// La base devuelve códigos de región de 2-3 letras para Colombia.
const DEPARTAMENTOS_CO = {
  AMA: 'Amazonas', ANT: 'Antioquia', ARA: 'Arauca', ATL: 'Atlántico', BOL: 'Bolívar',
  BOY: 'Boyacá', CAL: 'Caldas', CAQ: 'Caquetá', CAS: 'Casanare', CAU: 'Cauca',
  CES: 'Cesar', CHO: 'Chocó', COR: 'Córdoba', CUN: 'Cundinamarca', DC: 'Bogotá D.C.',
  GUA: 'Guainía', GUV: 'Guaviare', HUI: 'Huila', LAG: 'La Guajira', MAG: 'Magdalena',
  MET: 'Meta', NAR: 'Nariño', NSA: 'Norte de Santander', PUT: 'Putumayo', QUI: 'Quindío',
  RIS: 'Risaralda', SAN: 'Santander', SAP: 'San Andrés y Providencia', SUC: 'Sucre',
  TOL: 'Tolima', VAC: 'Valle del Cauca', VAU: 'Vaupés', VID: 'Vichada',
};

const MAX_LONGITUD_IP = 45;
const PREFIJO_IPV4_EN_IPV6 = '::ffff:';

let proveedor;

function cargarProveedorLocal() {
  if (process.env.GEOIP_DESACTIVADO === 'true') return () => null;
  try {
    const geoip = createRequire(import.meta.url)('geoip-lite');
    return (ip) => geoip.lookup(ip);
  } catch (err) {
    logger.warn(`[geolocalizacion] Base de ubicaciones no disponible: ${err.message}`);
    return () => null;
  }
}

/** Para pruebas: sustituye el proveedor (`undefined` vuelve al real). */
export function definirProveedorUbicacion(fn) {
  proveedor = fn;
}

/** IP lista para guardar: sin el prefijo IPv4-en-IPv6 y acotada; null si no hay una válida. */
export function normalizarIp(ip) {
  if (typeof ip !== 'string') return null;
  const limpia = ip.trim();
  const sinPrefijo = limpia.toLowerCase().startsWith(PREFIJO_IPV4_EN_IPV6) ? limpia.slice(PREFIJO_IPV4_EN_IPV6.length) : limpia;
  return sinPrefijo && sinPrefijo.length <= MAX_LONGITUD_IP ? sinPrefijo : null;
}

/** @returns {{ pais: string|null, departamento: string|null, ciudad: string|null }|null} */
export function ubicarIp(ip) {
  const normalizada = normalizarIp(ip);
  if (!normalizada) return null;
  proveedor ??= cargarProveedorLocal();
  let hallazgo;
  try {
    hallazgo = proveedor(normalizada);
  } catch {
    return null;
  }
  if (!hallazgo?.country) return null;
  const departamento = hallazgo.country === 'CO' && hallazgo.region
    ? (DEPARTAMENTOS_CO[hallazgo.region] ?? null)
    : null;
  return { pais: hallazgo.country, departamento, ciudad: hallazgo.city || null };
}
