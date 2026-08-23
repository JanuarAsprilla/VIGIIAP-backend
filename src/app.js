import * as Sentry from '@sentry/node';
import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import compression from 'compression';
import morgan from 'morgan';
import cookieParser from 'cookie-parser';
import swaggerUi from 'swagger-ui-express';
import { openApiSpec } from './docs/openapi.js';

import { query } from './config/database.js';
import logger from './utils/logger.js';
import { rateLimiter } from './middlewares/rateLimiter.js';
import { optionalAuthenticate } from './middlewares/auth.js';
import { requestId } from './middlewares/requestId.js';
import { errorHandler } from './middlewares/errorHandler.js';
import { notFound } from './middlewares/notFound.js';

import authRoutes from './modules/auth/auth.routes.js';
import mapassRoutes from './modules/mapas/mapas.routes.js';
import documentosRoutes from './modules/documentos/documentos.routes.js';
import solicitudesRoutes from './modules/solicitudes/solicitudes.routes.js';
import usuariosRoutes from './modules/usuarios/usuarios.routes.js';
import adminRoutes from './modules/admin/admin.routes.js';
import categoriasRoutes from './modules/categorias/categorias.routes.js';
import descargasRoutes from './modules/descargas/descargas.routes.js';
import publicRoutes from './modules/public/public.routes.js';

const app = express();

// Confiar en el primer proxy (Render, Nginx) para que req.ip refleje la IP real del cliente
// y el rate limiting opere sobre la IP correcta en lugar de la del proxy.
app.set('trust proxy', 1);

// ─── Orígenes permitidos (CORS estricto) ─────────────────────────────────────
const allowedOrigins = (process.env.CORS_ORIGIN ?? '')
  .split(',')
  .map((o) => o.trim())
  .filter(Boolean);

// ─── Security headers (Helmet hardening) ─────────────────────────────────────
app.use(
  helmet({
    // Previene clickjacking incrustando la app en iframes de terceros
    frameguard: { action: 'deny' },
    // HSTS: fuerza HTTPS por 1 año + incluye subdominios
    hsts: {
      maxAge: 31_536_000,
      includeSubDomains: true,
      preload: true,
    },
    // Oculta el header X-Powered-By para no revelar el stack
    hidePoweredBy: true,
    // Referrer limitado al mismo origen
    referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
    // CSP: permite solo recursos del propio origen + CDNs declarados
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'"],
        imgSrc: ["'self'", 'data:', 'https:'],
        connectSrc: ["'self'"],
        fontSrc: ["'self'"],
        objectSrc: ["'none'"],
        mediaSrc: ["'self'"],
        frameSrc: ["'none'"],
        upgradeInsecureRequests: [],
      },
    },
    // Impide que las páginas se guarden en cache de proxies intermedios
    noSniff: true,
    // Permissions Policy: desactiva APIs del navegador que no usa la API
    permittedCrossDomainPolicies: { permittedPolicies: 'none' },
  }),
);

// Permissions-Policy explícita (no incluida en helmet por defecto)
app.use((_req, res, next) => {
  res.setHeader(
    'Permissions-Policy',
    'camera=(), microphone=(), geolocation=(), interest-cohort=()',
  );
  next();
});

// ─── Request ID — correlación de logs en producción ──────────────────────────
app.use(requestId);

// ─── Response Time — latencia visible para monitoreo ─────────────────────────
app.use((_req, res, next) => {
  const start = Date.now();
  const end = res.end.bind(res);
  res.end = (...args) => {
    if (!res.headersSent) res.setHeader('X-Response-Time', `${Date.now() - start}ms`);
    return end(...args);
  };
  next();
});

// ─── Health check (antes del CORS — Render y monitores no envían Origin) ─────
// Registrado aquí para que Render y los load balancers no sean bloqueados por
// el CORS estricto de producción. El endpoint no devuelve datos sensibles.
app.get('/health', async (_req, res) => {
  const checks = { db: 'ok', redis: 'ok', storage: 'ok' };
  let critical = false;

  try { await query('SELECT 1'); }
  catch { checks.db = 'unreachable'; critical = true; }

  try {
    const { getRedisClient } = await import('./middlewares/cache.js');
    const rc = getRedisClient();
    if (rc?.isReady) await rc.ping();
    else checks.redis = 'not_configured';
  } catch { checks.redis = 'unreachable'; }

  try {
    const { HeadBucketCommand } = await import('@aws-sdk/client-s3');
    const r2 = (await import('./config/r2.js')).default;
    await r2.send(new HeadBucketCommand({ Bucket: process.env.R2_BUCKET_NAME }));
  } catch { checks.storage = 'unreachable'; }

  res.status(critical ? 503 : 200).json({
    status:    critical ? 'degraded' : 'ok',
    uptime:    Math.floor(process.uptime()),
    timestamp: new Date().toISOString(),
    ...checks,
  });
});

// ─── CORS estricto ────────────────────────────────────────────────────────────
const IS_PROD = process.env.NODE_ENV === 'production';
app.use(
  cors({
    origin(origin, callback) {
      // En producción se requiere Origin explícito — bloquea peticiones server-side anónimas.
      // En desarrollo se permiten curl y Postman (sin Origin) para facilitar el trabajo local.
      if (!origin) {
        if (IS_PROD) {
          return callback(Object.assign(new Error('CORS: Origin requerido en producción'), { status: 403 }));
        }
        return callback(null, true);
      }
      if (allowedOrigins.includes(origin)) return callback(null, true);
      callback(Object.assign(new Error(`CORS: origen no permitido — ${origin}`), { status: 403 }));
    },
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    exposedHeaders: ['X-Total-Count'],
    credentials: true,
    maxAge: 86_400, // preflight cacheado 24h
  }),
);
app.use(compression());
// Token personalizado que redacta tokens sensibles de la URL antes de loguear.
// Previene que tokens de reset/verificación (64 chars hex) aparezcan en los logs de Render.
morgan.token('safe-url', (req) =>
  req.originalUrl.replace(
    /(\/(?:reset-password|verificar-email)\/)[A-Fa-f0-9]{32,}/g,
    '$1[REDACTED]',
  ),
);

const morganFormat = process.env.NODE_ENV === 'production'
  ? ':remote-addr - :remote-user [:date[clf]] ":method :safe-url HTTP/:http-version" :status :res[content-length] ":referrer" ":user-agent"'
  : 'dev';

app.use(morgan(morganFormat, { stream: { write: (msg) => logger.info(msg.trim()) } }));
app.use(cookieParser());
// Límite conservador: la API solo maneja JSON de texto; los archivos van vía multipart (multer).
app.use(express.json({ limit: '1mb' }));
// express.urlencoded deshabilitado: API JSON pura. Ningún endpoint lo requiere —
// multipart/form-data es procesado por multer en las rutas de subida de archivos.
//
// IMPORTANTE: deshabilitar urlencoded NO es, por sí solo, una mitigación de CSRF.
// Las cookies de sesión usan sameSite: 'None' (ver src/utils/cookieOptions.js), así
// que el navegador SÍ adjunta la cookie en peticiones cross-site, y tanto un <form>
// multipart/form-data (procesado por multer en /documentos, /mapas,
// /categorias/:nombre/thumbnail, /solicitudes/:id/archivos) como uno con
// Content-Type "simple" son peticiones que el navegador envía sin preflight CORS.
// La protección real es el middleware CSRF explícito (src/middlewares/csrf.js),
// aplicado a las rutas de estado mutante bajo /admin, /usuarios, /solicitudes,
// /mapas, /documentos, /categorias y las de sesión de /auth.

// optionalAuthenticate antes del rateLimiter para que req.user sea visible y el
// límite por usuario (500 req/15min) se active correctamente en lugar de usar solo IP.
app.use(optionalAuthenticate);
app.use(rateLimiter);

// ─── API Docs (Swagger UI) — solo en entornos no-producción ──────────────────
if (process.env.NODE_ENV !== 'production') {
  app.get('/api/docs.json', (_req, res) => res.json(openApiSpec));
  app.use('/api/docs', swaggerUi.serve, swaggerUi.setup(openApiSpec, {
    customSiteTitle: 'VIGIIAP API Docs',
    swaggerOptions: { persistAuthorization: true },
  }));
}

// ─── Rutas de la API v1 ───────────────────────────────────────────────────────
// Todos los endpoints bajo /api/v1 — facilita versiones futuras sin romper clientes activos.
// /api/* se mantiene como alias de transición durante el ciclo de despliegue.
import { Router } from 'express';
const v1 = Router();

// Cache-Control: no-store en rutas que devuelven datos de sesión o privados.
// Impide que proxies intermedios cacheen respuestas sensibles.
// mapas/documentos/categorías son datos públicos — permanecen cacheables.
const noStore = (_req, res, next) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  next();
};

v1.use('/auth',        noStore, authRoutes);
v1.use('/mapas',               mapassRoutes);
v1.use('/documentos',          documentosRoutes);
v1.use('/solicitudes', noStore, solicitudesRoutes);
v1.use('/usuarios',    noStore, usuariosRoutes);
v1.use('/admin',       noStore, adminRoutes);
v1.use('/categorias',          categoriasRoutes);
v1.use('/descargar',   noStore, descargasRoutes);
v1.use('/public',              publicRoutes);

app.use('/api/v1', v1);
app.use('/api',    v1); // alias de transición — se retira en v2

// Redirect de seguridad: si el link del email apunta al backend, redirige al frontend.
// El token se valida como hex puro — previene path traversal e inyección de headers.
const HEX_TOKEN_RE = /^[A-Fa-f0-9]{40,128}$/;
app.get('/verificar-email/:token', (req, res) => {
  if (!HEX_TOKEN_RE.test(req.params.token)) return res.status(400).json({ error: 'Token inválido' });
  const base = (process.env.FRONTEND_URL || 'https://vigiiap.iiap.gov.co').replace(/\/$/, '');
  res.redirect(302, `${base}/verificar-email/${req.params.token}`);
});
app.get('/reset-password/:token', (req, res) => {
  if (!HEX_TOKEN_RE.test(req.params.token)) return res.status(400).json({ error: 'Token inválido' });
  const base = (process.env.FRONTEND_URL || 'https://vigiiap.iiap.gov.co').replace(/\/$/, '');
  res.redirect(302, `${base}/reset-password/${req.params.token}`);
});

// ─── Manejo de errores ────────────────────────────────────────────────────────
Sentry.setupExpressErrorHandler(app);
app.use(notFound);
app.use(errorHandler);

export default app;
