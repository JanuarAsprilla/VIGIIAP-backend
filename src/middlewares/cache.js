/**
 * cache.js — Cache Redis para endpoints GET públicos.
 * Omite cache si el request tiene autenticación o admin=true.
 * Falla silenciosamente: si Redis no está disponible, la request sigue sin cache.
 */
import { createClient } from 'redis';
import logger from '../utils/logger.js';

let redis = null;

export function getRedisClient() {
  if (!redis && process.env.REDIS_URL) {
    redis = createClient({ url: process.env.REDIS_URL });
    redis.on('error', (err) => logger.warn(`[cache] Redis error: ${err.message}`));
    redis.connect().catch((err) => logger.warn(`[cache] Redis no disponible: ${err.message}`));
  }
  return redis;
}

/**
 * Middleware de cache para endpoints GET públicos.
 * @param {number} ttlSeconds - Tiempo de vida del cache en segundos
 */
export function cacheMiddleware(ttlSeconds) {
  return async (req, res, next) => {
    // No cachear requests autenticados.
    // admin=true en query string era un bypass de cache controlado por el cliente
    // → cualquier usuario podía forzar hits directos a BD (DoS). Eliminado.
    if (req.cookies?.vigiiap_token || req.headers.authorization) {
      return next();
    }

    const client = getRedisClient();
    if (!client?.isReady) return next();

    // Whitelist de params en la cache key — previene flooding de keys únicas en Redis.
    const safeParams = new URLSearchParams();
    const ALLOWED_PARAMS = ['page', 'limit', 'categoria', 'q', 'anio', 'tipo'];
    for (const p of ALLOWED_PARAMS) {
      if (req.query[p]) safeParams.set(p, String(req.query[p]).slice(0, 100));
    }
    const key = `cache:${req.path}:${safeParams.toString()}`.slice(0, 256);

    try {
      const cached = await client.get(key);
      if (cached) {
        res.setHeader('X-Cache', 'HIT');
        return res.json(JSON.parse(cached));
      }

      // Interceptar res.json para cachear la respuesta
      const originalJson = res.json.bind(res);
      res.json = (data) => {
        client.setEx(key, ttlSeconds, JSON.stringify(data))
          .catch((err) => logger.warn(`[cache] Error guardando: ${err.message}`));
        res.setHeader('X-Cache', 'MISS');
        return originalJson(data);
      };
      next();
    } catch (err) {
      logger.warn(`[cache] Error consultando Redis: ${err.message}`);
      next();
    }
  };
}

/**
 * Invalida entradas de cache que coincidan con el patrón.
 * @param {string} pattern - ej: 'cache:/mapas*'
 */
export async function invalidateCache(pattern) {
  const client = getRedisClient();
  if (!client?.isReady) return;
  try {
    const keys = await client.keys(pattern);
    if (keys.length) {
      await client.del(keys);
      logger.debug(`[cache] Invalidadas ${keys.length} entradas: ${pattern}`);
    }
  } catch (err) {
    logger.warn(`[cache] Error invalidando ${pattern}: ${err.message}`);
  }
}
