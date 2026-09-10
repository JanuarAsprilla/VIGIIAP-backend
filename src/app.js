import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import compression from 'compression';
import morgan from 'morgan';
import cookieParser from 'cookie-parser';
import swaggerUi from 'swagger-ui-express';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { openApiSpec } from './docs/openapi.js';

// Version leída de package.json (no de una env var) — así /health siempre
// refleja el código realmente empaquetado en la imagen, sin depender de que
// nadie recuerde actualizar una variable en el deploy.
const __dirname = dirname(fileURLToPath(import.meta.url));
const { version: APP_VERSION } = JSON.parse(
  readFileSync(join(__dirname, '..', 'package.json'), 'utf8'),
);

import { query } from './config/database.js';
import logger from './utils/logger.js';
import { rateLimiter } from './middlewares/rateLimiter.js';
import { optionalAuthenticate } from './middlewares/auth.js';
import { requestId } from './middlewares/requestId.js';
import { errorHandler } from './middlewares/errorHandler.js';
import { notFound } from './middlewares/notFound.js';
import { maintenanceGate } from './middlewares/maintenanceMode.js';

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
    version:   APP_VERSION,
    uptime:    Math.floor(process.uptime()),
    timestamp: new Date().toISOString(),
    ...checks,
  });
});

// ─── CORS estricto ────────────────────────────────────────────────────────────
app.use(
  cors({
    origin(origin, callback) {
      // Sin Origin: se deja pasar en todo entorno. Exigirlo en producción se
      // pensó como defensa contra peticiones server-side anónimas, pero el
      // proxy de borde real del instituto (fuera de nuestro control) no
      // siempre reenvía el header Origin — eso dejó CADA petición real de
      // navegador (login incluido) bloqueada con 403 en producción, un
      // apagón total detectado en vivo. La protección real contra CSRF no
      // depende de Origin: es el token HMAC explícito (src/middlewares/csrf.js)
      // más sameSite:'Lax' — Origin ausente tampoco demuestra nada por sí
      // solo, cualquier cliente no-navegador puede omitirlo u omitir su
      // verificación igual de fácil. Cuando SÍ llega un Origin, se sigue
      // validando estricto contra la lista blanca.
      if (!origin) return callback(null, true);
      if (allowedOrigins.includes(origin)) return callback(null, true);
      callback(Object.assign(new Error(`CORS: origen no permitido — ${origin}`), { status: 403 }));
    },
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-CSRF-Token'],
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
// Las cookies de sesión usan sameSite: 'Lax' (ver src/utils/cookieOptions.js), que
// ya bloquea el envío de la cookie en un POST cross-site (incluido un <form>
// enviado desde otro sitio) — pero eso depende de que el navegador de cada
// usuario respete esa marca, y no es una garantía absoluta. Tanto un <form>
// multipart/form-data (procesado por multer en /documentos, /mapas,
// /categorias/:nombre/thumbnail, /solicitudes/:id/archivos) como uno con
// Content-Type "simple" son peticiones que el navegador envía sin preflight CORS.
// La protección real, explícita y no dependiente del navegador, es el
// middleware CSRF (src/middlewares/csrf.js),
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
v1.use('/mapas',               maintenanceGate, mapassRoutes);
v1.use('/documentos',          maintenanceGate, documentosRoutes);
v1.use('/solicitudes', noStore, maintenanceGate, solicitudesRoutes);
v1.use('/usuarios',    noStore, usuariosRoutes);
v1.use('/admin',       noStore, adminRoutes);
v1.use('/categorias',          maintenanceGate, categoriasRoutes);
v1.use('/descargar',   noStore, maintenanceGate, descargasRoutes);
v1.use('/public',              maintenanceGate, publicRoutes);

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
app.use(notFound);
app.use(errorHandler);

export default app;
