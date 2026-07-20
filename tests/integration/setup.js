/**
 * Setup para tests de integración — requiere PostgreSQL real accesible.
 *
 * Variables de entorno necesarias (.env.test):
 *   DB_HOST, DB_PORT, DB_NAME (debe contener "test"), DB_USER, DB_PASSWORD, JWT_SECRET
 *
 * Ejecutar: npm run test:integration
 *
 * Aplica migraciones en BD de test aislada antes de la suite y limpia datos
 * al terminar cada archivo de test para mantener tests independientes.
 */
import 'dotenv/config';
import { connectDB } from '../../src/config/database.js';
import { runMigrations } from '../../db/migrate.js';
import { query } from '../../src/config/database.js';

if (!process.env.DB_NAME?.includes('test')) {
  throw new Error(
    'SEGURIDAD: DB_NAME debe contener "test" para tests de integración. ' +
    'Nunca ejecutar contra BD de producción.'
  );
}

beforeAll(async () => {
  await connectDB();
  await runMigrations();
});

/** Limpia todas las tablas de datos entre tests — mantiene el schema */
export async function cleanDatabase() {
  await query(`
    TRUNCATE TABLE
      refresh_tokens, revoked_tokens, sessions,
      solicitud_archivos, solicitudes,
      descarga_log, file_scan_log, geo_custodia,
      audit_log, visitantes, usuarios
    RESTART IDENTITY CASCADE
  `);
}
