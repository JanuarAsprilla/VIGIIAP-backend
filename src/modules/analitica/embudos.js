import { EVENTOS_PERMITIDOS } from './eventos.js';

/**
 * Embudos de conversión: recorridos que interesa medir. Cada paso es una página (`ruta`) o una
 * acción del visitante (`evento`) y debe ocurrir después del anterior dentro de la misma sesión.
 * El catálogo vive en el código a propósito: nada de lo que envíe un cliente decide qué se consulta.
 */
export const EMBUDOS = {
  mapas: {
    titulo: 'De la portada a descargar un mapa',
    pasos: [
      { etiqueta: 'Visita la portada', ruta: '/' },
      { etiqueta: 'Entra a Mapas', ruta: '/mapas' },
      { etiqueta: 'Descarga un mapa', evento: 'descarga_mapa' },
    ],
  },
  documentos: {
    titulo: 'De la portada a descargar un documento',
    pasos: [
      { etiqueta: 'Visita la portada', ruta: '/' },
      { etiqueta: 'Entra a Documentos', ruta: '/documentos' },
      { etiqueta: 'Descarga un documento', evento: 'descarga_documento' },
    ],
  },
  geovisores: {
    titulo: 'De la portada a abrir un geovisor',
    pasos: [
      { etiqueta: 'Visita la portada', ruta: '/' },
      { etiqueta: 'Entra a Geovisores', ruta: '/geovisores' },
      { etiqueta: 'Abre un geovisor', evento: 'abrir_geovisor' },
    ],
  },
  herramientas: {
    titulo: 'De la portada a usar una herramienta',
    pasos: [
      { etiqueta: 'Visita la portada', ruta: '/' },
      { etiqueta: 'Entra a Herramientas', ruta: '/herramientas' },
      { etiqueta: 'Usa una herramienta', evento: 'usar_herramienta' },
    ],
  },
};

const MIN_PASOS = 2;
const MAX_PASOS = 5;

function fuenteDelPaso(paso, indiceParametro) {
  if (paso.evento) {
    if (!EVENTOS_PERMITIDOS.includes(paso.evento)) throw new Error(`Evento fuera del catálogo: ${paso.evento}`);
    return `SELECT e.session_id, e.creado_en AS t
       FROM analytics_eventos e
       JOIN analytics_sessions s ON s.id = e.session_id
       WHERE s.es_bot = false AND e.creado_en BETWEEN $1 AND $2 AND e.nombre = $${indiceParametro}`;
  }
  return `SELECT p.session_id, p.creado_en AS t
       FROM analytics_pageviews p
       JOIN analytics_sessions s ON s.id = p.session_id
       WHERE s.es_bot = false AND p.es_area_admin = false AND p.creado_en BETWEEN $1 AND $2 AND p.ruta = $${indiceParametro}`;
}

/**
 * Arma una sola consulta que cuenta, por paso, las sesiones que llegaron a él habiendo pasado por
 * todos los anteriores en orden. Los valores de cada paso viajan como parámetros ($3 en adelante).
 */
export function construirConsultaEmbudo(pasos) {
  if (pasos.length < MIN_PASOS || pasos.length > MAX_PASOS) {
    throw new Error(`Un embudo necesita entre ${MIN_PASOS} y ${MAX_PASOS} pasos`);
  }
  const params = pasos.map((paso) => paso.evento ?? paso.ruta);
  const ctes = pasos.map((paso, i) => {
    const fuente = fuenteDelPaso(paso, i + 3);
    if (i === 0) return `p1 AS (SELECT m.session_id, MIN(m.t) AS t FROM (${fuente}) m GROUP BY m.session_id)`;
    return `p${i + 1} AS (
       SELECT m.session_id, MIN(m.t) AS t FROM (${fuente}) m
       JOIN p${i} ON p${i}.session_id = m.session_id AND m.t > p${i}.t
       GROUP BY m.session_id)`;
  });
  const conteos = pasos.map((_, i) => `(SELECT COUNT(*)::int FROM p${i + 1}) AS c${i + 1}`);
  return { sql: `WITH ${ctes.join(',\n     ')}\n     SELECT ${conteos.join(', ')}`, params };
}
