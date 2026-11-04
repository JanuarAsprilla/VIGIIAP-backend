import pg from 'pg';
import logger from '../utils/logger.js';

const { Pool } = pg;

// SSL lo controla DB_SSL explícitamente, no NODE_ENV — un Postgres propio en
// servidor local (sin TLS configurado) también corre con NODE_ENV=production,
// así que forzar SSL solo por estar en producción rompía esa conexión.
// DB_SSL_REJECT_UNAUTHORIZED=false (Supabase usa su propia CA, no la del sistema).
const sslConfig = process.env.DB_SSL === 'true'
  ? { rejectUnauthorized: process.env.DB_SSL_REJECT_UNAUTHORIZED === 'true' }
  : false;

function crearPool({ max, connectionTimeoutMillis = 5_000 }) {
  const comunes = { ssl: sslConfig, max, idleTimeoutMillis: 30_000, connectionTimeoutMillis };
  return new Pool(
    // DATABASE_URL tiene prioridad — permite configuración única en Render/AWS sin vars individuales
    process.env.DATABASE_URL
      ? { connectionString: process.env.DATABASE_URL, ...comunes }
      : {
          host:     process.env.DB_HOST,
          port:     Number(process.env.DB_PORT) || 5432,
          database: process.env.DB_NAME,
          user:     process.env.DB_USER,
          password: process.env.DB_PASSWORD,
          ...comunes,
        }
  );
}

const pool = crearPool({ max: 20 });

// La API pública del Observatorio (anónima, consultas de hasta 5 s) tiene su propio pool pequeño: una
// ráfaga de consultas pesadas se encola ahí y no agota las conexiones del login y del panel de administración.
const POOL_BIODIVERSIDAD_MAX = Math.min(10, Math.max(1, Number(process.env.BIODIVERSIDAD_POOL_MAX) || 6));
const poolBiodiversidad = crearPool({ max: POOL_BIODIVERSIDAD_MAX, connectionTimeoutMillis: 3_000 });

for (const p of [pool, poolBiodiversidad]) {
  p.on('error', (err) => {
    logger.error('Error inesperado en pool de DB:', err);
  });
}

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

/** Obtiene un cliente del pool para transacciones manuales ('biodiversidad' usa el pool aislado del Observatorio). */
export function getClient(destino = 'principal') {
  return (destino === 'biodiversidad' ? poolBiodiversidad : pool).connect();
}

export default pool;
