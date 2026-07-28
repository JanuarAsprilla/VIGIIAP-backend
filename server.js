import 'dotenv/config';
import app from './src/app.js';
import { connectDB } from './src/config/database.js';
import pool from './src/config/database.js';
import { runMigrations } from './db/migrate.js';
import { loadBlacklist } from './src/utils/tokenBlacklist.js';
import { initEmailQueue } from './src/utils/emailQueue.js';
import logger from './src/utils/logger.js';

const PORT = process.env.PORT || 4000;

function validateEnv() {
  // JWT_SECRET es crítica — sin ella cualquier token JWT es inseguro
  if (!process.env.JWT_SECRET) {
    logger.error('[startup] FATAL: JWT_SECRET no está definida. El servidor no puede arrancar de forma segura.');
    process.exit(1);
  }
  // HS256 requiere al menos 256 bits de entropía (32 bytes → 64 hex chars o 43+ base64 chars).
  // Un secreto débil ("secret", "admin") es vulnerable a ataques de diccionario sobre JWTs.
  if (process.env.JWT_SECRET.length < 32) {
    logger.error('[startup] FATAL: JWT_SECRET demasiado corta (mínimo 32 caracteres para HS256). Genera una con: openssl rand -hex 32');
    process.exit(1);
  }
  // Rechazar valores placeholder conocidos que pasan el check de longitud pero son predecibles.
  const KNOWN_WEAK_SECRETS = [
    'REPLACE_WITH_REAL_SECRET_MIN_32_CHARS',
    'your_jwt_secret_here',
    'changeme',
    'secret',
    'supersecret',
    'mysecret',
  ];
  if (KNOWN_WEAK_SECRETS.some((weak) => process.env.JWT_SECRET.toLowerCase().includes(weak.toLowerCase()))) {
    logger.error('[startup] FATAL: JWT_SECRET contiene un valor de ejemplo o placeholder. Genera uno seguro con: openssl rand -hex 32');
    process.exit(1);
  }

  // Validar formato de JWT_EXPIRES_IN si está definida (ej: '15m', '1h', '7d', o segundos numéricos)
  if (process.env.JWT_EXPIRES_IN) {
    const validExpiry = /^\d+[smhd]$/.test(process.env.JWT_EXPIRES_IN) || /^\d+$/.test(process.env.JWT_EXPIRES_IN);
    if (!validExpiry) {
      logger.error(`[startup] FATAL: JWT_EXPIRES_IN="${process.env.JWT_EXPIRES_IN}" formato inválido. Usa '15m', '1h', '7d' o segundos numéricos.`);
      process.exit(1);
    }
  }

  // Advertir si TOTP_ENCRYPTION_KEY falta — 2FA fallará en runtime si está habilitado en BD
  if (!process.env.TOTP_ENCRYPTION_KEY) {
    logger.warn('[startup] TOTP_ENCRYPTION_KEY no configurada — el módulo 2FA no funcionará correctamente.');
  } else if (process.env.TOTP_ENCRYPTION_KEY.length < 64) {
    logger.error('[startup] FATAL: TOTP_ENCRYPTION_KEY demasiado corta (mínimo 64 hex chars = 32 bytes). Genera una con: openssl rand -hex 32');
    process.exit(1);
  }

  // Validar CORS_ORIGIN — si está vacío o malformado, todas las requests con Origin serán bloqueadas
  const corsOrigin = process.env.CORS_ORIGIN ?? '';
  if (!corsOrigin) {
    logger.warn('[startup] CORS_ORIGIN no configurada — solo requests sin Origin (curl, Postman) serán aceptadas.');
  } else {
    const origins = corsOrigin.split(',').map((o) => o.trim()).filter(Boolean);
    const invalid = origins.filter((o) => { try { new URL(o); return false; } catch { return true; } });
    if (invalid.length) {
      logger.error(`[startup] FATAL: CORS_ORIGIN contiene orígenes inválidos: ${invalid.join(', ')}`);
      process.exit(1);
    }
    logger.info(`[startup] CORS habilitado para ${origins.length} origen(es): ${origins.join(', ')}`);
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
  } else {
    const mailPort   = Number(process.env.MAIL_PORT);
    const mailSecure = process.env.MAIL_SECURE === 'true';
    // Puerto 465 requiere TLS directo (MAIL_SECURE=true); puerto 587 usa STARTTLS (MAIL_SECURE=false).
    // Cualquier otra combinación indica una mala configuración.
    const validCombos = (mailPort === 587 && !mailSecure) || (mailPort === 465 && mailSecure);
    if (!validCombos) {
      logger.error(
        `[startup] FATAL: Combinación MAIL_PORT=${mailPort} / MAIL_SECURE=${mailSecure} inválida. ` +
        'Usa MAIL_PORT=587 + MAIL_SECURE=false (STARTTLS) o MAIL_PORT=465 + MAIL_SECURE=true (TLS directo).',
      );
      process.exit(1);
    }
    logger.info(`[startup] Email: ${process.env.MAIL_HOST}:${mailPort} — ${mailSecure ? 'TLS directo' : 'STARTTLS'}`);
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
  initEmailQueue();

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
