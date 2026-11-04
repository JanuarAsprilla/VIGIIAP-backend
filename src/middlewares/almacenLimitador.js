/**
 * Almacén de contadores del limitador de tráfico, compartido entre instancias a través de Redis.
 *
 * Con varias instancias, un contador en memoria de cada una multiplicaría el límite efectivo por
 * el número de instancias (también el de intentos de inicio de sesión). Aquí el conteo vive en
 * Redis con un único comando atómico. Si Redis no está configurado, no está conectado, falla o
 * tarda demasiado, esa petición se cuenta en la memoria de la instancia: el limitador nunca deja
 * de proteger ni bloquea a todo el mundo por una caída de Redis.
 */
import { MemoryStore } from 'express-rate-limit';
import { getRedisClient } from './cache.js';
import logger from '../utils/logger.js';

// Incrementa y fija el vencimiento en el mismo paso; si la clave quedó sin vencimiento por
// cualquier motivo, lo repone para que el contador nunca sea permanente.
const SCRIPT_INCREMENTO = `
local cuenta = redis.call('INCR', KEYS[1])
if cuenta == 1 then redis.call('PEXPIRE', KEYS[1], ARGV[1]) end
local ttl = redis.call('PTTL', KEYS[1])
if ttl < 0 then
  redis.call('PEXPIRE', KEYS[1], ARGV[1])
  ttl = tonumber(ARGV[1])
end
return { cuenta, ttl }`;

const TIMEOUT_REDIS_MS = 250;
const ENFRIAMIENTO_MS = 5_000;
const INTERVALO_AVISO_MS = 60_000;

let ultimoAviso = 0;

function conLimite(promesa, ms) {
  let temporizador;
  const limite = new Promise((_, rechazar) => {
    temporizador = setTimeout(() => rechazar(new Error(`Redis no respondió en ${ms} ms`)), ms);
  });
  // Si el límite gana, el comando colgado puede rechazar más tarde: se atiende para no tumbar el proceso.
  promesa.catch(() => {});
  return Promise.race([promesa, limite]).finally(() => clearTimeout(temporizador));
}

class AlmacenLimitador {
  // Los contadores no son locales a este proceso: así lo declara la librería a sus validaciones.
  localKeys = false;

  constructor(nombre, { obtenerCliente, timeoutMs, enfriamientoMs }) {
    this.nombre = nombre;
    this.obtenerCliente = obtenerCliente;
    this.timeoutMs = timeoutMs;
    this.enfriamientoMs = enfriamientoMs;
    this.memoria = new MemoryStore();
    this.enfriadoHasta = 0;
    this.windowMs = undefined;
  }

  init(opciones) {
    this.windowMs = opciones.windowMs;
    this.memoria.init(opciones);
  }

  clave(key) {
    return `rl:${this.nombre}:${key}`;
  }

  /** El cliente Redis si se puede usar ahora; null si no (no configurado, sin conectar o en enfriamiento). */
  clienteDisponible() {
    if (Date.now() < this.enfriadoHasta) return null;
    const cliente = this.obtenerCliente();
    return cliente?.isReady ? cliente : null;
  }

  registrarFallo(err) {
    this.enfriadoHasta = Date.now() + this.enfriamientoMs;
    if (Date.now() - ultimoAviso > INTERVALO_AVISO_MS) {
      ultimoAviso = Date.now();
      logger.warn(`[limitador] Redis no disponible para "${this.nombre}", se cuenta en memoria de la instancia: ${err.message}`);
    }
  }

  async increment(key) {
    const cliente = this.clienteDisponible();
    if (cliente) {
      try {
        const [totalHits, ttl] = await conLimite(
          cliente.eval(SCRIPT_INCREMENTO, { keys: [this.clave(key)], arguments: [String(this.windowMs)] }),
          this.timeoutMs,
        );
        const restanteMs = ttl > 0 ? ttl : this.windowMs;
        return { totalHits: Number(totalHits), resetTime: new Date(Date.now() + restanteMs) };
      } catch (err) {
        this.registrarFallo(err);
      }
    }
    return this.memoria.increment(key);
  }

  async decrement(key) {
    const cliente = this.clienteDisponible();
    if (cliente) {
      try {
        await conLimite(cliente.decr(this.clave(key)), this.timeoutMs);
        return;
      } catch (err) {
        this.registrarFallo(err);
      }
    }
    await this.memoria.decrement(key);
  }

  async resetKey(key) {
    this.memoria.resetKey(key);
    const cliente = this.clienteDisponible();
    if (!cliente) return;
    try {
      await conLimite(cliente.del(this.clave(key)), this.timeoutMs);
    } catch (err) {
      this.registrarFallo(err);
    }
  }
}

/** Un almacén por limitador (cada uno con su prefijo): la librería no admite compartir una instancia. */
export function crearAlmacen(nombre, { obtenerCliente = getRedisClient, timeoutMs = TIMEOUT_REDIS_MS, enfriamientoMs = ENFRIAMIENTO_MS } = {}) {
  return new AlmacenLimitador(nombre, { obtenerCliente, timeoutMs, enfriamientoMs });
}
