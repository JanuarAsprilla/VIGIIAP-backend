import { monitorEventLoopDelay } from 'node:perf_hooks';
import logger from '../utils/logger.js';

export const NIVEL = Object.freeze({ NORMAL: 0, DEGRADADO: 1, EXTREMO: 2 });

const RESOLUCION_HISTOGRAMA_MS = 20;
const NS_POR_MS = 1e6;
const PERCENTIL_RETRASO = 99;
// Para salir de un nivel la medida debe bajar de este porcentaje del umbral: evita oscilar en el borde.
const HISTERESIS_POR_DEFECTO = 0.7;

const DEFECTOS = Object.freeze({
  LOAD_SHED_RETRASO_NO_CRITICO_MS: 200,
  LOAD_SHED_RETRASO_TODO_MS: 1_000,
  LOAD_SHED_EN_VUELO_NO_CRITICO: 400,
  LOAD_SHED_EN_VUELO_TODO: 1_500,
  LOAD_SHED_RETRY_AFTER_S: 5,
  LOAD_SHED_INTERVALO_MS: 1_000,
  LOAD_SHED_MANTENER_MS: 10_000,
});

const enteroPositivo = (valor, porDefecto) => {
  const n = Math.trunc(Number(valor));
  return n >= 1 ? n : porDefecto;
};

/** Umbrales desde el entorno; un valor ausente o inválido conserva el default. */
export function leerConfigDegradacion(env = process.env) {
  return {
    retrasoNoCriticoMs: enteroPositivo(env.LOAD_SHED_RETRASO_NO_CRITICO_MS, DEFECTOS.LOAD_SHED_RETRASO_NO_CRITICO_MS),
    retrasoTodoMs: enteroPositivo(env.LOAD_SHED_RETRASO_TODO_MS, DEFECTOS.LOAD_SHED_RETRASO_TODO_MS),
    enVueloNoCritico: enteroPositivo(env.LOAD_SHED_EN_VUELO_NO_CRITICO, DEFECTOS.LOAD_SHED_EN_VUELO_NO_CRITICO),
    enVueloTodo: enteroPositivo(env.LOAD_SHED_EN_VUELO_TODO, DEFECTOS.LOAD_SHED_EN_VUELO_TODO),
    retryAfterS: enteroPositivo(env.LOAD_SHED_RETRY_AFTER_S, DEFECTOS.LOAD_SHED_RETRY_AFTER_S),
    intervaloMs: enteroPositivo(env.LOAD_SHED_INTERVALO_MS, DEFECTOS.LOAD_SHED_INTERVALO_MS),
    mantenerMs: enteroPositivo(env.LOAD_SHED_MANTENER_MS, DEFECTOS.LOAD_SHED_MANTENER_MS),
    histeresis: HISTERESIS_POR_DEFECTO,
  };
}

const SIN_PREFIJO_API = /^\/api(?:\/v1)?(?=\/|$)/;
// Salud, estado de mantenimiento y todo lo que mantiene o protege una sesión: nunca se descarta.
const EXENTAS = /^\/(?:health|estado|auth|oauth)(?:\/|$)/;
const NO_CRITICAS = [
  /^\/analitica(?:\/|$)/,
  /^\/admin\/(?:export|audit|reportes)(?:\/|$)/,
  /^\/informes(?!\/configuracion(?:\/|$))(?:\/|$)/,
];

/** 'exenta' (nunca), 'no_critica' (primero) o 'normal' (solo en el último extremo). */
export function clasificarRuta(_metodo, ruta) {
  const limpia = ruta.replace(SIN_PREFIJO_API, '') || '/';
  if (EXENTAS.test(limpia)) return 'exenta';
  return NO_CRITICAS.some((patron) => patron.test(limpia)) ? 'no_critica' : 'normal';
}

const superaUmbral = (m, retrasoMs, enVuelo, factor) => (
  m.retrasoMs >= retrasoMs * factor || m.enVuelo >= enVuelo * factor
);

/** Nivel siguiente a partir del actual y de las medidas, con histéresis para la salida. */
export function siguienteNivel(actual, medidas, config) {
  const { retrasoNoCriticoMs: rNC, retrasoTodoMs: rT, enVueloNoCritico: vNC, enVueloTodo: vT, histeresis } = config;
  if (superaUmbral(medidas, rT, vT, 1)) return NIVEL.EXTREMO;
  if (actual === NIVEL.EXTREMO && superaUmbral(medidas, rT, vT, histeresis)) return NIVEL.EXTREMO;
  if (superaUmbral(medidas, rNC, vNC, 1)) return NIVEL.DEGRADADO;
  if (actual >= NIVEL.DEGRADADO && superaUmbral(medidas, rNC, vNC, histeresis)) return NIVEL.DEGRADADO;
  return NIVEL.NORMAL;
}

function medidorDeBucle() {
  const histograma = monitorEventLoopDelay({ resolution: RESOLUCION_HISTOGRAMA_MS });
  histograma.enable();
  return {
    medir() {
      const ms = histograma.percentile(PERCENTIL_RETRASO) / NS_POR_MS;
      histograma.reset();
      return Number.isFinite(ms) ? ms : 0;
    },
    detener: () => histograma.disable(),
  };
}

const NOMBRE_NIVEL = { [NIVEL.NORMAL]: 'normal', [NIVEL.DEGRADADO]: 'degradado (solo lo no crítico)', [NIVEL.EXTREMO]: 'extremo (todo salvo lo exento)' };

/**
 * Modo degradado: mide el retraso del bucle de eventos (p99 del último intervalo) y las peticiones en vuelo y,
 * por encima de los umbrales, responde 503 + Retry-After primero a lo no crítico y solo en el último extremo al
 * resto. Lo exento (salud, login, refresh, rutas de seguridad) nunca se descarta.
 */
export function crearDegradacion({
  config = leerConfigDegradacion(), medirRetraso, aleatorio = Math.random, iniciarTemporizador = true,
} = {}) {
  const medidor = medirRetraso ? null : medidorDeBucle();
  const leerRetraso = medirRetraso ?? medidor.medir;
  let nivel = NIVEL.NORMAL;
  let enVuelo = 0;
  let descartadas = 0;
  let desde = 0;
  let cambioEn = 0;

  function evaluar() {
    const medidas = { retrasoMs: leerRetraso(), enVuelo };
    const nuevo = siguienteNivel(nivel, medidas, config);
    if (nuevo === nivel) return;
    // Descartar reduce las peticiones en vuelo y el retraso: sin un tiempo mínimo el modo entraría y saldría cada intervalo.
    if (nuevo < nivel && Date.now() - cambioEn < config.mantenerMs) return;
    const detalle = `retraso p${PERCENTIL_RETRASO}=${Math.round(medidas.retrasoMs)}ms enVuelo=${medidas.enVuelo}`;
    if (nivel === NIVEL.NORMAL) {
      desde = Date.now();
      descartadas = 0;
      logger.warn(`[degradacion] ENTRA en modo ${NOMBRE_NIVEL[nuevo]} — ${detalle}`);
    } else if (nuevo === NIVEL.NORMAL) {
      logger.info(`[degradacion] SALE del modo degradado tras ${Math.round((Date.now() - desde) / 1000)}s — descartadas=${descartadas} — ${detalle}`);
    } else {
      logger.warn(`[degradacion] CAMBIA a modo ${NOMBRE_NIVEL[nuevo]} — ${detalle}`);
    }
    nivel = nuevo;
    cambioEn = Date.now();
  }

  const temporizador = iniciarTemporizador ? setInterval(evaluar, config.intervaloMs) : null;
  temporizador?.unref();

  function middleware(req, res, next) {
    enVuelo += 1;
    let liberada = false;
    res.once('close', () => { if (!liberada) { liberada = true; enVuelo -= 1; } });

    const clase = clasificarRuta(req.method, req.path);
    const descartar = nivel !== NIVEL.NORMAL && clase !== 'exenta' && (clase === 'no_critica' || nivel === NIVEL.EXTREMO);
    if (!descartar) return next();

    descartadas += 1;
    const espera = config.retryAfterS + Math.floor(aleatorio() * config.retryAfterS);
    res.setHeader('Retry-After', String(espera));
    return res.status(503).json({ error: 'Servicio con alta demanda. Intenta de nuevo en unos segundos.' });
  }

  return {
    middleware,
    evaluar,
    estado: () => ({ nivel, enVuelo, descartadas }),
    detener() {
      if (temporizador) clearInterval(temporizador);
      medidor?.detener();
    },
  };
}

let instancia = null;

/** Middleware del modo degradado, o null si LOAD_SHEDDING no está en «true» (apagado por defecto). */
export function middlewareDegradacion() {
  if (process.env.LOAD_SHEDDING !== 'true') return null;
  if (!instancia) {
    instancia = crearDegradacion();
    logger.info('[degradacion] Modo degradado habilitado (LOAD_SHEDDING=true)');
  }
  return instancia.middleware;
}

export function detenerDegradacion() {
  instancia?.detener();
  instancia = null;
}
