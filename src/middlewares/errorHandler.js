import { ZodError } from 'zod';
import logger from '../utils/logger.js';

export function errorHandler(err, _req, res, _next) {
  // Errores de validación Zod → 422 con detalle de campos
  if (err instanceof ZodError) {
    return res.status(422).json({
      error: 'Datos de entrada inválidos',
      fields: err.errors.map(e => ({ field: e.path.join('.'), message: e.message })),
    });
  }

  // Errores de Multer
  if (err.code === 'LIMIT_FILE_SIZE') {
    return res.status(400).json({ error: 'El archivo supera el tamaño máximo permitido' });
  }

  const status = err.status || err.statusCode || 500;
  const message = err.message || 'Error interno del servidor';

  if (status >= 500) {
    logger.error(err.stack || message);
  }

  res.status(status).json({
    error: message,
    ...(err.code && { code: err.code }),
  });
}
