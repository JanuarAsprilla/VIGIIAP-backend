import { query } from '../../config/database.js';
import { normalizarIp, ubicarIp } from '../../utils/geolocalizacion.js';

const VENTANA_DIAS = 14;

function fmtLocalDate(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function rangoPorDefecto() {
  const hasta = new Date();
  const desde = new Date();
  desde.setDate(desde.getDate() - VENTANA_DIAS);
  desde.setHours(0, 0, 0, 0);
  return { desde, hasta };
}

/** Serie de 14 días + comparación semana actual vs. anterior — mismo cálculo
 *  que getDashboardTendencias (admin.service.js), para que las tarjetas KPI
 *  de analítica se vean y se calculen igual que el resto del panel. */
function calcularTendencia(conteosPorDia) {
  const hoy = new Date();
  const dias14 = Array.from({ length: VENTANA_DIAS }, (_, i) => {
    const d = new Date(hoy);
    d.setDate(hoy.getDate() - (VENTANA_DIAS - 1 - i));
    return fmtLocalDate(d);
  });
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
export async function getResumen() {
  const { desde } = rangoPorDefecto();
  const { rows: pv } = await query(
    `SELECT p.creado_en FROM analytics_pageviews p
     JOIN analytics_sessions s ON s.id = p.session_id
     WHERE p.creado_en >= $1 AND s.es_bot = false`,
    [desde],
  );
  const { rows: sesiones } = await query(
    `SELECT primera_visita_en FROM analytics_sessions
     WHERE primera_visita_en >= $1 AND es_bot = false`,
    [desde],
  );

  const pvPorDia = new Map();
  pv.forEach((r) => {
    const dia = fmtLocalDate(new Date(r.creado_en));
    pvPorDia.set(dia, (pvPorDia.get(dia) ?? 0) + 1);
  });
  const sesionesPorDia = new Map();
  sesiones.forEach((r) => {
    const dia = fmtLocalDate(new Date(r.primera_visita_en));
    sesionesPorDia.set(dia, (sesionesPorDia.get(dia) ?? 0) + 1);
  });

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
       WHERE s.primera_visita_en >= $1 AND s.es_bot = false
       GROUP BY s.id
     ) sub`,
    [desde],
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

export async function getPaginasTop({ desde, hasta, limit = 10 }) {
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

export async function getDispositivos({ desde, hasta }) {
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

export async function getFuentesTrafico({ desde, hasta }) {
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

export async function getEntradaSalida({ desde, hasta, limit = 10 }) {
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
export async function getUbicaciones({ desde, hasta, limit = 40 }) {
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
