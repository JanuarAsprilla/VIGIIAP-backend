import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import compression from 'compression';
import morgan from 'morgan';

import { rateLimiter } from './middlewares/rateLimiter.js';
import { errorHandler } from './middlewares/errorHandler.js';
import { notFound } from './middlewares/notFound.js';

import authRoutes from './modules/auth/auth.routes.js';
import mapassRoutes from './modules/mapas/mapas.routes.js';
import documentosRoutes from './modules/documentos/documentos.routes.js';
import noticiasRoutes from './modules/noticias/noticias.routes.js';
import solicitudesRoutes from './modules/solicitudes/solicitudes.routes.js';
import usuariosRoutes from './modules/usuarios/usuarios.routes.js';
import adminRoutes from './modules/admin/admin.routes.js';

const app = express();

// ─── Orígenes permitidos (CORS estricto) ─────────────────────────────────────
const allowedOrigins = (process.env.CORS_ORIGIN ?? '')
  .split(',')
  .map((o) => o.trim())
  .filter(Boolean);

// ─── Security headers (Helmet hardening) ─────────────────────────────────────
app.use(
  helmet({
    // Evita que el navegador "adivine" el content-type → protege contra MIME sniffing
    contentTypeOptions: true,
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
    // Evita que la página se abra en frames (protección adicional XFO)
    xssFilter: true,
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
app.use(morgan(process.env.NODE_ENV === 'production' ? 'combined' : 'dev'));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(rateLimiter);

// ─── Health check ─────────────────────────────────────────────────────────────
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', env: process.env.NODE_ENV, version: '1.0.0' });
});

// ─── Rutas de la API ──────────────────────────────────────────────────────────
app.use('/api/auth', authRoutes);
app.use('/api/mapas', mapassRoutes);
app.use('/api/documentos', documentosRoutes);
app.use('/api/noticias', noticiasRoutes);
app.use('/api/solicitudes', solicitudesRoutes);
app.use('/api/usuarios', usuariosRoutes);
app.use('/api/admin', adminRoutes);

// ─── Manejo de errores ────────────────────────────────────────────────────────
app.use(notFound);
app.use(errorHandler);

export default app;
