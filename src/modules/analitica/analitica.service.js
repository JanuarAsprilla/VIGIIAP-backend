import { query } from '../../config/database.js';
import { normalizarIp, ubicarIp } from '../../utils/geolocalizacion.js';
import { memoizar } from '../../utils/cacheLocal.js';

const VENTANA_DIAS = 14;
const ZONA_HORARIA = 'America/Bogota';
const MS_POR_DIA = 24 * 60 * 60 * 1000;

// Las lecturas del panel se repiten con cada recarga y cambian poco: 30 s bastan para absorber
// ráfagas sin que se note. En 0 se desactiva (los tests lo fijan así).
const TTL_PANEL_MS = Number(process.env.ANALITICA_CACHE_TTL_MS ?? 30_000);

// Los días se cuentan en hora de Colombia sin importar la zona del servidor.
const FORMATO_DIA = new Intl.DateTimeFormat('en-CA', {
  timeZone: ZONA_HORARIA, year: 'numeric', month: '2-digit', day: '2-digit',
});

function fmtLocalDate(d) {
  return FORMATO_DIA.format(d);
}

// Medianoche de Bogotá de hace VENTANA_DIAS días: misma ventana que antes, calculada en la base.
const INICIO_VENTANA_SQL = `(date_trunc('day', NOW() AT TIME ZONE '${ZONA_HORARIA}') - INTERVAL '${VENTANA_DIAS} days') AT TIME ZONE '${ZONA_HORARIA}'`;

/** Serie de 14 días + comparación semana actual vs. anterior — mismo cálculo
 *  que getDashboardTendencias (admin.service.js), para que las tarjetas KPI
 *  de analítica se vean y se calculen igual que el resto del panel. */
function calcularTendencia(conteosPorDia) {
  const hoy = new Date();
  const dias14 = Array.from({ length: VENTANA_DIAS }, (_, i) => (
    fmtLocalDate(new Date(hoy.getTime() - (VENTANA_DIAS - 1 - i) * MS_POR_DIA))
  ));
  const serie = dias14.map((d) => conteosPorDia.get(d) ?? 0);
  const semanaActual = serie.slice(7).reduce((a, b) => a + b, 0);
  const semanaAnterior = serie.slice(0, 7).reduce((a, b) => a + b, 0);
  const deltaPct = semanaAnterior === 0
    ? (semanaActual > 0 ? 100 : 0)
    : Math.round(((semanaActual - semanaAnterior) / semanaAnterior) * 100);
  return { serie7: serie.slice(7), semanaActual, semanaAnterior, deltaPct };
}

/** Detección de bots como red de seguridad server-side (defensa en
 *  profundidad): la mayoría de bots reales ni ejecutan JS y nunca llegan a
 *  este endpoint, pero algunos sí (crawlers de previsualización de links,
 *  monitores de uptime). No se filtran en el INSERT -- se guardan con
 *  es_bot=true y se excluyen de las agregaciones, para no perder el dato. */
const PATRON_BOT = /bot|crawler|spider|crawling|headless|phantom|slurp|facebookexternalhit|preview|monitor|pingdom|uptimerobot/i;

export function esBot(userAgent) {
  return !userAgent || PATRON_BOT.test(userAgent);
}

/**
 * Registra una vista de página. Crea la sesión si `sessionId` es nuevo (con la IP y la
 * ubicación aproximada de quien la abre, salvo bots); si ya existe, solo actualiza
 * `ultima_actividad_en`. La IP se borra sola pasado el plazo de retención (retencionDatos.js)
 * y nunca se liga a un usuario -- ver migraciones 050 y 059.
 */
export async function registrarPageview({
  sessionId, ruta, titulo, dispositivo, navegador, sistemaOperativo,
  referrerInicial, utmSource, utmMedium, utmCampaign, esAreaAdmin, userAgent, ip,
}) {
  const bot = esBot(userAgent);
  const { rows } = await query('SELECT id FROM analytics_sessions WHERE id = $1', [sessionId]);
  const esSesionNueva = rows.length === 0;

  if (esSesionNueva) {
    const ubicacion = bot ? null : ubicarIp(ip);
    await query(
      `INSERT INTO analytics_sessions
         (id, dispositivo, navegador, sistema_operativo, referrer_inicial, utm_source, utm_medium, utm_campaign, es_bot,
          ip, pais, departamento, ciudad)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
      [sessionId, dispositivo, navegador ?? null, sistemaOperativo ?? null,
        referrerInicial ?? null, utmSource ?? null, utmMedium ?? null, utmCampaign ?? null, bot,
        bot ? null : normalizarIp(ip), ubicacion?.pais ?? null, ubicacion?.departamento ?? null, ubicacion?.ciudad ?? null],
    );
  } else {
    await query('UPDATE analytics_sessions SET ultima_actividad_en = NOW() WHERE id = $1', [sessionId]);
  }

  await query(
    `INSERT INTO analytics_pageviews (session_id, ruta, titulo, es_entrada, es_area_admin)
     VALUES ($1, $2, $3, $4, $5)`,
    [sessionId, ruta, titulo ?? null, esSesionNueva, esAreaAdmin],
  );
}

/** KPIs principales con tendencia 14 días, mismo formato que getDashboardTendencias. */
async function calcularResumen() {
  // Se agrupa primero por hora y solo esas ~336 horas se convierten a día de Bogotá: convertir
  // la zona fila por fila costaba más que traer las filas a Node.
  const { rows: pv } = await query(
    `SELECT to_char((h.hora AT TIME ZONE '${ZONA_HORARIA}')::date, 'YYYY-MM-DD') AS dia, SUM(h.n)::int AS total
     FROM (
       SELECT date_trunc('hour', p.creado_en) AS hora, COUNT(*) AS n
       FROM analytics_pageviews p
       JOIN analytics_sessions s ON s.id = p.session_id
       WHERE p.creado_en >= ${INICIO_VENTANA_SQL} AND s.es_bot = false
       GROUP BY 1
     ) h
     GROUP BY 1`,
  );
  const { rows: sesiones } = await query(
    `SELECT to_char((h.hora AT TIME ZONE '${ZONA_HORARIA}')::date, 'YYYY-MM-DD') AS dia, SUM(h.n)::int AS total
     FROM (
       SELECT date_trunc('hour', primera_visita_en) AS hora, COUNT(*) AS n
       FROM analytics_sessions
       WHERE primera_visita_en >= ${INICIO_VENTANA_SQL} AND es_bot = false
       GROUP BY 1
     ) h
     GROUP BY 1`,
  );

  const pvPorDia = new Map(pv.map((r) => [r.dia, r.total]));
  const sesionesPorDia = new Map(sesiones.map((r) => [r.dia, r.total]));

  const { rows: statsSesiones } = await query(
    `SELECT
       COUNT(*)::int AS total_sesiones,
       COUNT(*) FILTER (WHERE pv_count = 1)::int AS sesiones_una_pagina,
       AVG(duracion_seg) FILTER (WHERE duracion_seg IS NOT NULL) AS duracion_prom_seg
     FROM (
       SELECT s.id,
              COUNT(p.id) AS pv_count,
              EXTRACT(EPOCH FROM (MAX(p.creado_en) - MIN(p.creado_en))) AS duracion_seg
       FROM analytics_sessions s
       JOIN analytics_pageviews p ON p.session_id = s.id
       WHERE s.primera_visita_en >= ${INICIO_VENTANA_SQL} AND s.es_bot = false
       GROUP BY s.id
     ) sub`,
  );
  const { total_sesiones, sesiones_una_pagina, duracion_prom_seg } = statsSesiones[0];
  const tasaRebote = total_sesiones > 0 ? Math.round((sesiones_una_pagina / total_sesiones) * 100) : 0;

  return {
    paginasVistas: calcularTendencia(pvPorDia),
    visitantes: calcularTendencia(sesionesPorDia),
    tasaRebotePct: tasaRebote,
    duracionPromedioSeg: Math.round(Number(duracion_prom_seg) || 0),
  };
}

export const getResumen = memoizar(calcularResumen, TTL_PANEL_MS);

export const getPaginasTop = memoizar(calcularPaginasTop, TTL_PANEL_MS);

async function calcularPaginasTop({ desde, hasta, limit = 10 }) {
  const { rows } = await query(
    `SELECT p.ruta, COUNT(*)::int AS vistas, COUNT(DISTINCT p.session_id)::int AS visitantes
     FROM analytics_pageviews p
     JOIN analytics_sessions s ON s.id = p.session_id
     WHERE p.creado_en BETWEEN $1 AND $2 AND s.es_bot = false AND p.es_area_admin = false
     GROUP BY p.ruta ORDER BY vistas DESC LIMIT $3`,
    [desde, hasta, limit],
  );
  return rows;
}

export const getDispositivos = memoizar(calcularDispositivos, TTL_PANEL_MS);

async function calcularDispositivos({ desde, hasta }) {
  const { rows } = await query(
    `SELECT dispositivo, COUNT(*)::int AS sesiones
     FROM analytics_sessions
     WHERE primera_visita_en BETWEEN $1 AND $2 AND es_bot = false
     GROUP BY dispositivo ORDER BY sesiones DESC`,
    [desde, hasta],
  );
  return rows;
}

/** Clasifica el referrer inicial en categorías (Directo/Buscadores/Redes/Otros
 *  sitios). Se hace en JS y no en SQL: la lista de dominios conocidos cambia
 *  con el tiempo y es más simple de mantener/testear como datos en código. */
const BUSCADORES = ['google.', 'bing.', 'duckduckgo.', 'yahoo.', 'ecosia.'];
const REDES_SOCIALES = ['facebook.', 'twitter.', 'x.com', 'instagram.', 'linkedin.', 'whatsapp.', 't.co'];

function categorizarFuente(referrer) {
  if (!referrer) return 'Directo';
  const host = referrer.toLowerCase();
  if (BUSCADORES.some((d) => host.includes(d))) return 'Buscadores';
  if (REDES_SOCIALES.some((d) => host.includes(d))) return 'Redes sociales';
  return 'Otros sitios';
}

export const getFuentesTrafico = memoizar(calcularFuentesTrafico, TTL_PANEL_MS);

async function calcularFuentesTrafico({ desde, hasta }) {
  const { rows } = await query(
    `SELECT referrer_inicial, COUNT(*)::int AS sesiones
     FROM analytics_sessions
     WHERE primera_visita_en BETWEEN $1 AND $2 AND es_bot = false
     GROUP BY referrer_inicial`,
    [desde, hasta],
  );
  const porCategoria = new Map();
  rows.forEach((r) => {
    const cat = categorizarFuente(r.referrer_inicial);
    porCategoria.set(cat, (porCategoria.get(cat) ?? 0) + r.sesiones);
  });
  return Array.from(porCategoria, ([fuente, sesiones]) => ({ fuente, sesiones }))
    .sort((a, b) => b.sesiones - a.sesiones);
}

export const getEntradaSalida = memoizar(calcularEntradaSalida, TTL_PANEL_MS);

async function calcularEntradaSalida({ desde, hasta, limit = 10 }) {
  const { rows: entradas } = await query(
    `SELECT ruta, COUNT(*)::int AS veces FROM analytics_pageviews p
     JOIN analytics_sessions s ON s.id = p.session_id
     WHERE p.creado_en BETWEEN $1 AND $2 AND p.es_entrada = true
       AND s.es_bot = false AND p.es_area_admin = false
     GROUP BY ruta ORDER BY veces DESC LIMIT $3`,
    [desde, hasta, limit],
  );
  const { rows: salidas } = await query(
    `SELECT ruta, COUNT(*)::int AS veces FROM (
       SELECT DISTINCT ON (p.session_id) p.ruta, p.session_id
       FROM analytics_pageviews p
       JOIN analytics_sessions s ON s.id = p.session_id
       WHERE p.creado_en BETWEEN $1 AND $2 AND s.es_bot = false AND p.es_area_admin = false
       ORDER BY p.session_id, p.creado_en DESC
     ) ultimas
     GROUP BY ruta ORDER BY veces DESC LIMIT $3`,
    [desde, hasta, limit],
  );
  return { entradas, salidas };
}

/** Sesiones por país y, dentro de Colombia, por departamento. Las sin ubicación se cuentan aparte. */
export const getUbicaciones = memoizar(calcularUbicaciones, TTL_PANEL_MS);

async function calcularUbicaciones({ desde, hasta, limit = 40 }) {
  const { rows: paises } = await query(
    `SELECT pais, COUNT(*)::int AS sesiones
     FROM analytics_sessions
     WHERE primera_visita_en BETWEEN $1 AND $2 AND es_bot = false AND pais IS NOT NULL
     GROUP BY pais ORDER BY sesiones DESC LIMIT $3`,
    [desde, hasta, limit],
  );
  const { rows: departamentos } = await query(
    `SELECT COALESCE(departamento, 'Sin determinar') AS departamento, COUNT(*)::int AS sesiones
     FROM analytics_sessions
     WHERE primera_visita_en BETWEEN $1 AND $2 AND es_bot = false AND pais = 'CO'
     GROUP BY COALESCE(departamento, 'Sin determinar') ORDER BY sesiones DESC LIMIT $3`,
    [desde, hasta, limit],
  );
  const { rows: sinUbicacion } = await query(
    `SELECT COUNT(*)::int AS sesiones
     FROM analytics_sessions
     WHERE primera_visita_en BETWEEN $1 AND $2 AND es_bot = false AND pais IS NULL`,
    [desde, hasta],
  );
  return { paises, departamentos, sinUbicacion: sinUbicacion[0]?.sesiones ?? 0 };
}

export { EVENTOS_PERMITIDOS } from './eventos.js';

/** Guarda un evento de una sesión existente. Devuelve false si se descarta (sesión inexistente o bot). */
export async function registrarEvento({ sessionId, nombre, recurso = null, ruta = null }) {
  const { rows } = await query('SELECT es_bot FROM analytics_sessions WHERE id = $1', [sessionId]);
  if (!rows.length || rows[0].es_bot) return false;
  await query(
    'INSERT INTO analytics_eventos (session_id, nombre, recurso, ruta) VALUES ($1, $2, $3, $4)',
    [sessionId, nombre, recurso, ruta],
  );
  return true;
}

/** Total por evento (con sesiones distintas) y los recursos más frecuentes de cada uno. */
export async function getEventosTop({ desde, hasta, limit = 20 }) {
  const { rows: eventos } = await query(
    `SELECT e.nombre, COUNT(*)::int AS total, COUNT(DISTINCT e.session_id)::int AS sesiones
     FROM analytics_eventos e
     JOIN analytics_sessions s ON s.id = e.session_id
     WHERE e.creado_en BETWEEN $1 AND $2 AND s.es_bot = false
     GROUP BY e.nombre ORDER BY total DESC`,
    [desde, hasta],
  );
  const { rows: recursos } = await query(
    `SELECT e.nombre, e.recurso, COUNT(*)::int AS total
     FROM analytics_eventos e
     JOIN analytics_sessions s ON s.id = e.session_id
     WHERE e.creado_en BETWEEN $1 AND $2 AND s.es_bot = false AND e.recurso IS NOT NULL
     GROUP BY e.nombre, e.recurso ORDER BY total DESC LIMIT $3`,
    [desde, hasta, limit],
  );
  return { eventos, recursos };
}

const VENTANA_TIEMPO_REAL_MIN = 5;

/** Visitantes con actividad en los últimos minutos y la página en la que están ahora. */
export async function getTiempoReal() {
  const { rows: activos } = await query(
    `SELECT COUNT(*)::int AS activos FROM analytics_sessions
     WHERE es_bot = false AND ultima_actividad_en >= NOW() - INTERVAL '${VENTANA_TIEMPO_REAL_MIN} minutes'`,
  );
  const { rows: paginasActuales } = await query(
    `SELECT ruta, COUNT(*)::int AS visitantes FROM (
       SELECT DISTINCT ON (p.session_id) p.ruta
       FROM analytics_pageviews p
       JOIN analytics_sessions s ON s.id = p.session_id
       WHERE s.es_bot = false AND p.es_area_admin = false
         AND s.ultima_actividad_en >= NOW() - INTERVAL '${VENTANA_TIEMPO_REAL_MIN} minutes'
         AND p.creado_en >= NOW() - INTERVAL '${VENTANA_TIEMPO_REAL_MIN} minutes'
       ORDER BY p.session_id, p.creado_en DESC
     ) actuales
     GROUP BY ruta ORDER BY visitantes DESC LIMIT 10`,
  );
  return { ventanaMin: VENTANA_TIEMPO_REAL_MIN, visitantesActivos: activos[0]?.activos ?? 0, paginasActuales };
}

/** Últimas sesiones con su IP (mientras no se haya purgado) y ubicación; solo para administradores. */
export async function getSesionesRecientes({ limit = 50 } = {}) {
  const { rows } = await query(
    `SELECT id, primera_visita_en, ip, pais, departamento, ciudad, dispositivo, navegador, sistema_operativo
     FROM analytics_sessions
     WHERE es_bot = false
     ORDER BY primera_visita_en DESC LIMIT $1`,
    [limit],
  );
  return rows;
}
