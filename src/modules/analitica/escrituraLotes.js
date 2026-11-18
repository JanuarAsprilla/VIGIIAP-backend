import { query } from '../../config/database.js';
import { normalizarIp, ubicarIp } from '../../utils/geolocalizacion.js';

/** Arma «($1,$2),($3,$4)…» y la lista plana de parámetros para un INSERT multifila. */
function valoresMultifila(filas) {
  const parametros = [];
  const grupos = filas.map((fila) => {
    const marcas = fila.map((valor) => { parametros.push(valor); return `$${parametros.length}`; });
    return `(${marcas.join(', ')})`;
  });
  return { texto: grupos.join(', '), parametros };
}

function filaSesion(pageview) {
  const ubicacion = pageview.esBot ? null : ubicarIp(pageview.ip);
  return [
    pageview.sessionId, pageview.dispositivo, pageview.navegador ?? null, pageview.sistemaOperativo ?? null,
    pageview.referrerInicial ?? null, pageview.utmSource ?? null, pageview.utmMedium ?? null, pageview.utmCampaign ?? null,
    pageview.esBot, pageview.esBot ? null : normalizarIp(pageview.ip),
    ubicacion?.pais ?? null, ubicacion?.departamento ?? null, ubicacion?.ciudad ?? null,
    pageview.creadoEn, pageview.creadoEn,
  ];
}

/** La primera vista de cada sesión que aún no existe en la base: la que la crea y cuenta como entrada. */
function primerasVistasDeSesionesNuevas(pageviews, existentes) {
  const primeras = new Map();
  for (const pv of pageviews) {
    if (!existentes.has(pv.sessionId) && !primeras.has(pv.sessionId)) primeras.set(pv.sessionId, pv);
  }
  return primeras;
}

async function escribirPageviews(pageviews) {
  const ids = [...new Set(pageviews.map((pv) => pv.sessionId))];
  const { rows } = await query('SELECT id FROM analytics_sessions WHERE id = ANY($1::uuid[])', [ids]);
  const existentes = new Set(rows.map((r) => r.id));
  const primeras = primerasVistasDeSesionesNuevas(pageviews, existentes);

  if (primeras.size > 0) {
    const { texto, parametros } = valoresMultifila([...primeras.values()].map(filaSesion));
    await query(
      `INSERT INTO analytics_sessions
         (id, dispositivo, navegador, sistema_operativo, referrer_inicial, utm_source, utm_medium, utm_campaign, es_bot,
          ip, pais, departamento, ciudad, primera_visita_en, ultima_actividad_en)
       VALUES ${texto}
       ON CONFLICT (id) DO NOTHING`,
      parametros,
    );
  }
  if (existentes.size > 0) {
    await query('UPDATE analytics_sessions SET ultima_actividad_en = NOW() WHERE id = ANY($1::uuid[])', [[...existentes]]);
  }

  const { texto, parametros } = valoresMultifila(pageviews.map((pv) => [
    pv.sessionId, pv.ruta, pv.titulo ?? null, primeras.get(pv.sessionId) === pv, pv.esAreaAdmin, pv.creadoEn,
  ]));
  await query(
    `INSERT INTO analytics_pageviews (session_id, ruta, titulo, es_entrada, es_area_admin, creado_en) VALUES ${texto}`,
    parametros,
  );
}

/** Solo se guardan los eventos de sesiones que existen y no son bots (mismo criterio que el camino directo). */
async function escribirEventos(eventos) {
  const { texto, parametros } = valoresMultifila(eventos.map((e) => [
    e.sessionId, e.nombre, e.recurso ?? null, e.ruta ?? null, e.creadoEn,
  ]));
  await query(
    `INSERT INTO analytics_eventos (session_id, nombre, recurso, ruta, creado_en)
     SELECT v.session_id::uuid, v.nombre, v.recurso, v.ruta, v.creado_en::timestamptz
     FROM (VALUES ${texto}) AS v(session_id, nombre, recurso, ruta, creado_en)
     JOIN analytics_sessions s ON s.id = v.session_id::uuid AND s.es_bot = false`,
    parametros.map((p) => (p instanceof Date ? p.toISOString() : p)),
  );
}

/** Escribe un lote de vistas y eventos; las vistas van primero para que sus sesiones ya existan al insertar los eventos. */
export async function escribirLoteAnalitica(lote) {
  const pageviews = lote.filter((e) => e.tipo === 'pageview');
  const eventos = lote.filter((e) => e.tipo === 'evento');
  if (pageviews.length > 0) await escribirPageviews(pageviews);
  if (eventos.length > 0) await escribirEventos(eventos);
}
