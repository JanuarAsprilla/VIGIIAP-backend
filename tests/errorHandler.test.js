import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ZodError } from 'zod';

vi.mock('../src/utils/logger.js', () => ({
  default: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

import { errorHandler } from '../src/middlewares/errorHandler.js';

function res() {
  return { status: vi.fn().mockReturnThis(), json: vi.fn() };
}

describe('errorHandler middleware', () => {
  const req = {};
  const next = vi.fn();

  beforeEach(() => vi.clearAllMocks());

  it('retorna 422 con campos para ZodError', () => {
    const zodErr = new ZodError([{ path: ['email'], message: 'Inválido', code: 'invalid_string' }]);
    const r = res();
    errorHandler(zodErr, req, r, next);
    expect(r.status).toHaveBeenCalledWith(422);
    expect(r.json).toHaveBeenCalledWith(expect.objectContaining({ fields: expect.any(Array) }));
  });

  it('retorna 400 para LIMIT_FILE_SIZE (Multer)', () => {
    const multerErr = Object.assign(new Error('File too large'), { code: 'LIMIT_FILE_SIZE' });
    const r = res();
    errorHandler(multerErr, req, r, next);
    expect(r.status).toHaveBeenCalledWith(400);
  });

  it('retorna 500 para error interno sin status', () => {
    const internalErr = new Error('algo salió mal');
    const r = res();
    errorHandler(internalErr, req, r, next);
    expect(r.status).toHaveBeenCalledWith(500);
  });

  it('retorna el status del error para errores con status < 500', () => {
    const clientErr = Object.assign(new Error('no encontrado'), { status: 404 });
    const r = res();
    errorHandler(clientErr, req, r, next);
    expect(r.status).toHaveBeenCalledWith(404);
    expect(r.json).toHaveBeenCalledWith(expect.objectContaining({ error: 'no encontrado' }));
  });

  it('incluye code en la respuesta si el error tiene code', () => {
    const err = Object.assign(new Error('conflicto'), { status: 409, code: 'DUPLICATE' });
    const r = res();
    errorHandler(err, req, r, next);
    expect(r.json.mock.calls[0][0]).toHaveProperty('code', 'DUPLICATE');
  });

  it('en producción oculta detalles del error 500', () => {
    process.env.NODE_ENV = 'production';
    const internalErr = new Error('Detalles internos sensibles');
    const r = res();
    errorHandler(internalErr, req, r, next);
    expect(r.json.mock.calls[0][0].error).toBe('Error interno del servidor');
    process.env.NODE_ENV = 'test';
  });

  it('usa err.statusCode si err.status no está definido', () => {
    const err = Object.assign(new Error('bad request'), { statusCode: 400 });
    const r = res();
    errorHandler(err, req, r, next);
    expect(r.status).toHaveBeenCalledWith(400);
  });
});
