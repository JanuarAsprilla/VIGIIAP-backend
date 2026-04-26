import 'dotenv/config';
import app from './src/app.js';
import { connectDB } from './src/config/database.js';
import { runMigrations } from './db/migrate.js';
import logger from './src/utils/logger.js';

const PORT = process.env.PORT || 4000;

function validateEnv() {
  const required = [
    'JWT_SECRET',
    'R2_ACCOUNT_ID', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY',
    'R2_BUCKET_NAME', 'R2_PUBLIC_URL',
  ];
  const missing = required.filter((k) => !process.env[k]);
  if (missing.length) {
    logger.warn(`[startup] Variables de entorno faltantes: ${missing.join(', ')}`);
    logger.warn('[startup] Los uploads de archivos fallarán hasta que estén configuradas.');
  }

  if (!process.env.FRONTEND_URL) {
    logger.warn('[startup] FRONTEND_URL no está definida — los links en emails de verificación usarán el valor por defecto.');
    logger.warn('[startup] Configura FRONTEND_URL en Render con la URL del frontend (ej: https://vigiiap.iiap.gov.co).');
  } else {
    logger.info(`[startup] FRONTEND_URL: ${process.env.FRONTEND_URL}`);
  }
}

async function start() {
  validateEnv();
  await connectDB();
  await runMigrations();
  app.listen(PORT, () => {
    logger.info(`VIGIIAP API corriendo en puerto ${PORT} [${process.env.NODE_ENV ?? 'development'}]`);
  });
}

start().catch((err) => {
  logger.error('Error al iniciar el servidor:', err);
  process.exit(1);
});
