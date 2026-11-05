import { describe, it, expect, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { paramUuid } from '../src/middlewares/paramUuid.js';

describe('paramUuid', () => {
  it('deja pasar un UUID válido', () => {
    const next = vi.fn();
    paramUuid({}, {}, next, '9f3e2a10-4b7c-4d5e-8a1f-0123456789ab');
    expect(next).toHaveBeenCalledOnce();
  });

  it.each(['abc', '123', "1' OR '1'='1", '9f3e2a10-4b7c-4d5e-8a1f-0123456789a', '../../etc/passwd', ''])(
    'responde 404 sin llegar a la base de datos con %j',
    (valor) => {
      const res = { status: vi.fn().mockReturnThis(), json: vi.fn() };
      const next = vi.fn();
      paramUuid({}, res, next, valor);
      expect(next).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(404);
    },
  );

  it('funciona como router.param: un id mal formado nunca ejecuta el manejador', async () => {
    const manejador = vi.fn((_req, res) => res.json({ ok: true }));
    const app = express();
    const router = express.Router();
    router.param('id', paramUuid);
    router.get('/mapa/:id', manejador);
    app.use(router);

    await request(app).get('/mapa/abc').expect(404);
    expect(manejador).not.toHaveBeenCalled();
    await request(app).get('/mapa/9f3e2a10-4b7c-4d5e-8a1f-0123456789ab').expect(200);
    expect(manejador).toHaveBeenCalledOnce();
  });
});
