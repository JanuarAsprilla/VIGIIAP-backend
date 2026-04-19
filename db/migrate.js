import 'dotenv/config';
import { readFileSync, readdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { query, connectDB } from '../src/config/database.js';
import logger from '../src/utils/logger.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

export async function runMigrations() {
  await query(`
    CREATE TABLE IF NOT EXISTS _migraciones (
      id        SERIAL PRIMARY KEY,
      nombre    VARCHAR(255) UNIQUE NOT NULL,
      ejecutado TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  const files = readdirSync(join(__dirname, 'migrations'))
    .filter((f) => f.endsWith('.sql'))
    .sort();

  let ran = 0;
  for (const file of files) {
    const { rows } = await query('SELECT id FROM _migraciones WHERE nombre=$1', [file]);
    if (rows.length) continue;

    const sql = readFileSync(join(__dirname, 'migrations', file), 'utf8');
    await query(sql);
    await query('INSERT INTO _migraciones (nombre) VALUES ($1)', [file]);
    logger.info(`[migration] ${file}`);
    ran++;
  }

  if (ran > 0) logger.info(`${ran} migracion(es) aplicada(s).`);
}

// CLI entrypoint: node db/migrate.js
const isCLI = process.argv[1] && fileURLToPath(import.meta.url).endsWith(process.argv[1].split('/').pop());
if (isCLI) {
  connectDB()
    .then(runMigrations)
    .then(() => { logger.info('Migraciones completadas.'); process.exit(0); })
    .catch((err) => { logger.error('Error en migraciones:', err); process.exit(1); });
}
