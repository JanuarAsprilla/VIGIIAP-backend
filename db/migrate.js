import 'dotenv/config';
import { readFileSync, readdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { query, connectDB, getClient } from '../src/config/database.js';
import logger from '../src/utils/logger.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Clave del candado de asesoría que serializa las migraciones entre réplicas (constante, no cambia entre versiones).
export const MIGRACIONES_LOCK_KEY = 7_302_025_001;

/** Ejecuta `trabajo(client)` en una transacción con el candado de migraciones; se libera sola al terminar (xact). */
async function enTransaccionBloqueada(trabajo) {
  const client = await getClient();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock($1)', [MIGRACIONES_LOCK_KEY]);
    const resultado = await trabajo(client);
    await client.query('COMMIT');
    return resultado;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

export async function runMigrations() {
  await enTransaccionBloqueada((client) => client.query(`
    CREATE TABLE IF NOT EXISTS _migraciones (
      id        SERIAL PRIMARY KEY,
      nombre    VARCHAR(255) UNIQUE NOT NULL,
      ejecutado TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `));

  const files = readdirSync(join(__dirname, 'migrations'))
    .filter((f) => f.endsWith('.sql'))
    .sort();

  let ran = 0;
  for (const file of files) {
    const { rows } = await query('SELECT id FROM _migraciones WHERE nombre=$1', [file]);
    if (rows.length) continue;

    const sql = readFileSync(join(__dirname, 'migrations', file), 'utf8');
    // Se vuelve a comprobar con el candado tomado: otra réplica pudo aplicarla mientras esperábamos.
    const aplicada = await enTransaccionBloqueada(async (client) => {
      const { rows: yaEsta } = await client.query('SELECT id FROM _migraciones WHERE nombre=$1', [file]);
      if (yaEsta.length) return false;
      await client.query(sql);
      await client.query('INSERT INTO _migraciones (nombre) VALUES ($1)', [file]);
      return true;
    });
    if (!aplicada) continue;
    logger.info(`[migration] ${file}`);
    ran++;
  }

  if (ran > 0) logger.info(`${ran} migracion(es) aplicada(s).`);
}

// CLI entrypoint: node db/migrate.js
const isCLI = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isCLI) {
  connectDB()
    .then(runMigrations)
    .then(() => { logger.info('Migraciones completadas.'); process.exit(0); })
    .catch((err) => { logger.error('Error en migraciones:', err); process.exit(1); });
}
