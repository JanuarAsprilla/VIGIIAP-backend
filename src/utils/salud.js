import { query } from '../config/database.js';
import { getRedisClient } from '../middlewares/cache.js';

const TIMEOUT_MS_POR_DEFECTO = 1_500;
const CACHE_MS_POR_DEFECTO = 2_000;

const enteroNoNegativo = (valor, porDefecto) => {
  if (valor === undefined || valor === '') return porDefecto;
  const n = Math.trunc(Number(valor));
  return n >= 0 ? n : porDefecto;
};

let apagando = false;
let enCurso = null;
let reciente = null;

/** Tras SIGTERM la instancia deja de declararse lista para que el balanceador la saque antes de cerrar. */
export function marcarApagando() {
  apagando = true;
}

/** Solo para pruebas. */
export function reiniciarSalud() {
  apagando = false;
  enCurso = null;
  reciente = null;
}

function conLimite(promesa, ms) {
  let temporizador;
  const limite = new Promise((_, rechazar) => {
    temporizador = setTimeout(() => rechazar(new Error('timeout')), ms);
  });
  return Promise.race([promesa, limite]).finally(() => clearTimeout(temporizador));
}

async function estadoBd(consultarBd, timeoutMs) {
  try {
    await conLimite(consultarBd('SELECT 1'), timeoutMs);
    return 'ok';
  } catch {
    return 'unreachable';
  }
}

async function estadoRedis({ clienteRedis, redisConfigurado, timeoutMs }) {
  if (!redisConfigurado) return 'not_configured';
  try {
    const cliente = clienteRedis();
    if (!cliente?.isReady) return 'unreachable';
    await conLimite(cliente.ping(), timeoutMs);
    return 'ok';
  } catch {
    return 'unreachable';
  }
}

async function comprobar(deps) {
  const [db, redis] = await Promise.all([estadoBd(deps.consultarBd, deps.timeoutMs), estadoRedis(deps)]);
  const listo = db === 'ok' && (!deps.redisObligatorio || redis === 'ok' || redis === 'not_configured');
  return { listo, cuerpo: { status: listo ? 'ready' : 'not_ready', db, redis } };
}

function depsDesdeEntorno() {
  return {
    consultarBd: query,
    clienteRedis: getRedisClient,
    redisConfigurado: Boolean(process.env.REDIS_URL),
    redisObligatorio: process.env.READY_REDIS_OBLIGATORIO === 'true',
    timeoutMs: enteroNoNegativo(process.env.READY_TIMEOUT_MS, TIMEOUT_MS_POR_DEFECTO),
    cacheMs: enteroNoNegativo(process.env.READY_CACHE_MS, CACHE_MS_POR_DEFECTO),
  };
}

/**
 * Readiness para balanceadores: la BD debe responder y Redis solo cuenta si READY_REDIS_OBLIGATORIO=true (la API
 * funciona sin él). Solo devuelve estados, nunca mensajes de error. Las llamadas simultáneas comparten una
 * comprobación y el resultado se reutiliza `cacheMs`: el endpoint es público y no debe amplificar carga.
 */
export function comprobarListo(deps = depsDesdeEntorno()) {
  if (apagando) return Promise.resolve({ listo: false, cuerpo: { status: 'draining' } });
  if (deps.cacheMs > 0 && reciente && Date.now() - reciente.en < deps.cacheMs) return Promise.resolve(reciente.valor);
  if (!enCurso) {
    enCurso = comprobar(deps)
      .then((valor) => { reciente = { en: Date.now(), valor }; return valor; })
      .finally(() => { enCurso = null; });
  }
  return enCurso;
}
