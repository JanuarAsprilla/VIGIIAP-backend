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

// ─── Seguridad y utilidades ───────────────────────────────────────────────────
app.use(helmet());
app.use(cors({
  origin: process.env.CORS_ORIGIN?.split(',') ?? '*',
  credentials: true,
}));
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
