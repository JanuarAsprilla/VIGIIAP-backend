import 'dotenv/config';
import app from './src/app.js';
import { connectDB } from './src/config/database.js';
import pool from './src/config/database.js';
import { runMigrations } from './db/migrate.js';
import { loadBlacklist } from './src/utils/tokenBlacklist.js';
import logger from './src/utils/logger.js';

const PORT = process.env.PORT || 4000;

function validateEnv() {
  // JWT_SECRET es crítica — sin ella cualquier token JWT es inseguro
  if (!process.env.JWT_SECRET) {
    logger.error('[startup] FATAL: JWT_SECRET no está definida. El servidor no puede arrancar de forma segura.');
    process.exit(1);
  }

  const required = [
    'R2_ACCOUNT_ID', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY',
    'R2_BUCKET_NAME', 'R2_PUBLIC_URL',
  ];
  const missing = required.filter((k) => !process.env[k]);
  if (missing.length) {
    logger.warn(`[startup] Variables de entorno faltantes: ${missing.join(', ')}`);
    logger.warn('[startup] Los uploads de archivos fallarán hasta que estén configuradas.');
  }

  const emailVars = ['MAIL_HOST', 'MAIL_PORT', 'MAIL_USER', 'MAIL_PASS', 'MAIL_FROM'];
  const missingEmail = emailVars.filter((k) => !process.env[k]);
  if (missingEmail.length) {
    logger.warn(`[startup] Email no configurado (${missingEmail.join(', ')}) — las notificaciones por email estarán desactivadas.`);
  }

  if (!process.env.FRONTEND_URL) {
    logger.warn('[startup] FRONTEND_URL no está definida — los links en emails de verificación usarán el valor por defecto.');
  } else {
    logger.info(`[startup] FRONTEND_URL: ${process.env.FRONTEND_URL}`);
  }
}

async function start() {
  validateEnv();
  await connectDB();
  await runMigrations();
  await loadBlacklist();

  // Purgar refresh tokens expirados o revocados hace más de 60 días para evitar crecimiento ilimitado de la tabla
  const { query } = await import('./src/config/database.js');
  query(
    `DELETE FROM refresh_tokens
     WHERE expira_en < NOW()
        OR (revocado = true AND creado_en < NOW() - INTERVAL '60 days')`,
  ).catch((err) => logger.warn(`[startup] Error purgando refresh_tokens: ${err.message}`));

  const server = app.listen(PORT, () => {
    logger.info(`VIGIIAP API corriendo en puerto ${PORT} [${process.env.NODE_ENV ?? 'development'}]`);
  });

  // Graceful shutdown — Render envía SIGTERM antes de reciclar el contenedor.
  // Dejamos que las requests en vuelo terminen (hasta 10 s) antes de salir.
  async function shutdown(signal) {
    logger.info(`[shutdown] ${signal} recibido — cerrando servidor...`);
    server.close(async () => {
      try {
        await pool.end();
        logger.info('[shutdown] Pool de BD cerrado. Saliendo limpiamente.');
      } catch (err) {
        logger.error('[shutdown] Error al cerrar pool:', err.message);
      }
      process.exit(0);
    });

    // Forzar salida si las conexiones no cierran en 10 s
    setTimeout(() => {
      logger.warn('[shutdown] Timeout de 10 s alcanzado. Forzando salida.');
      process.exit(1);
    }, 10_000).unref();
  }

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT',  () => shutdown('SIGINT'));
}

start().catch((err) => {
  logger.error('Error al iniciar el servidor:', err);
  process.exit(1);
});
