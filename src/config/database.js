import pg from 'pg';
import logger from '../utils/logger.js';

const { Pool } = pg;

// SSL: Supabase usa su propia CA — rejectUnauthorized:false mantiene cifrado TLS sin verificar chain.
const sslConfig = process.env.NODE_ENV === 'production'
  ? { rejectUnauthorized: process.env.DB_SSL_REJECT_UNAUTHORIZED === 'true' }
  : (process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false);

const pool = new Pool(
  // DATABASE_URL tiene prioridad — permite configuración única en Render/AWS sin vars individuales
  process.env.DATABASE_URL
    ? { connectionString: process.env.DATABASE_URL, ssl: sslConfig, max: 20, idleTimeoutMillis: 30_000, connectionTimeoutMillis: 5_000 }
    : {
        host:     process.env.DB_HOST,
        port:     Number(process.env.DB_PORT) || 5432,
        database: process.env.DB_NAME,
        user:     process.env.DB_USER,
        password: process.env.DB_PASSWORD,
        ssl:      sslConfig,
        max:      20,
        idleTimeoutMillis:     30_000,
        connectionTimeoutMillis: 5_000,
      }
);

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
