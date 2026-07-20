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

  if (status >= 500) {
    logger.error({
      message: err.message,
      stack:   err.stack,
      requestId: _req.requestId,
      path:    _req.path,
      method:  _req.method,
    });
    // En producción no exponemos detalles internos al cliente
    const publicMessage = process.env.NODE_ENV === 'production'
      ? 'Error interno del servidor'
      : (err.message || 'Error interno del servidor');
    return res.status(status).json({ error: publicMessage });
  }

  const message = err.message || 'Error del servidor';
  res.status(status).json({
    error: message,
    ...(err.code && { code: err.code }),
  });
}
