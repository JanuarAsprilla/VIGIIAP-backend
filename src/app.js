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

// ─── CORS estricto ────────────────────────────────────────────────────────────
app.use(
  cors({
    origin(origin, callback) {
      // Permite peticiones sin origen (curl, Postman en dev, health checks)
      if (!origin) return callback(null, true);
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
// express.urlencoded deshabilitado: API JSON pura.
// Con SameSite=None habilitado, urlencoded permitiría CSRF vía simple-form POST sin preflight.
// Ningún endpoint lo requiere — multipart/form-data es procesado por multer.

// optionalAuthenticate antes del rateLimiter para que req.user sea visible y el
// límite por usuario (500 req/15min) se active correctamente en lugar de usar solo IP.
app.use(optionalAuthenticate);
app.use(rateLimiter);

// ─── Health check (Render, load balancers, uptime monitors) ──────────────────
app.get('/health', async (_req, res) => {
  try {
    await query('SELECT 1');
    res.json({ status: 'ok', uptime: Math.floor(process.uptime()), timestamp: new Date().toISOString(), db: 'ok' });
  } catch {
    res.status(503).json({ status: 'degraded', db: 'unreachable' });
  }
});

// ─── API Docs (Swagger UI) — solo en entornos no-producción ──────────────────
if (process.env.NODE_ENV !== 'production') {
  app.get('/api/docs.json', (_req, res) => res.json(openApiSpec));
  app.use('/api/docs', swaggerUi.serve, swaggerUi.setup(openApiSpec, {
    customSiteTitle: 'VIGIIAP API Docs',
    swaggerOptions: { persistAuthorization: true },
  }));
}

// ─── Rutas de la API ──────────────────────────────────────────────────────────
app.use('/api/auth', authRoutes);
app.use('/api/mapas', mapassRoutes);
app.use('/api/documentos', documentosRoutes);
app.use('/api/solicitudes', solicitudesRoutes);
app.use('/api/usuarios', usuariosRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/categorias', categoriasRoutes);
app.use('/api/descargar', descargasRoutes);

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
