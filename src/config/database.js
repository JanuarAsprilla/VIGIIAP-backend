import pg from 'pg';
import logger from '../utils/logger.js';

const { Pool } = pg;

const pool = new Pool({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT) || 5432,
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  // Producción: SSL siempre activo con validación de certificado (Supabase lo requiere).
  // Desarrollo: controlado por DB_SSL=true en .env para PostgreSQL local sin TLS.
  // Nunca desactivar rejectUnauthorized en producción — aceptaría certs falsos (MITM).
  ssl: process.env.NODE_ENV === 'production'
    ? { rejectUnauthorized: true }
    : (process.env.DB_SSL === 'true'
        ? { rejectUnauthorized: process.env.DB_SSL_REJECT_UNAUTHORIZED !== 'false' }
        : false),
  max: 20,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
});

pool.on('error', (err) => {
  logger.error('Error inesperado en pool de DB:', err);
});

export async function connectDB() {
  const client = await pool.connect();
  logger.info('Conexión a PostgreSQL/PostGIS establecida');
  client.release();
}

/** Ejecuta una query y retorna las filas. */
export async function query(text, params) {
  const start = Date.now();
  const res = await pool.query(text, params);
  logger.debug(`Query ejecutada en ${Date.now() - start}ms — ${text.slice(0, 60)}`);
  return res;
}

/** Obtiene un cliente del pool para transacciones manuales. */
export function getClient() {
  return pool.connect();
}

export default pool;
