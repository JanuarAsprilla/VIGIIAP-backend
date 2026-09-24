/**
 * Tests unitarios para analitica.controller.js
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../src/modules/analitica/analitica.service.js', () => ({
  registrarPageview: vi.fn(),
  getResumen: vi.fn(),
  getPaginasTop: vi.fn(),
  getDispositivos: vi.fn(),
  getFuentesTrafico: vi.fn(),
  getEntradaSalida: vi.fn(),
}));

import * as analiticaService from '../src/modules/analitica/analitica.service.js';
import {
  pageview, resumen, paginasTop, dispositivos, fuentesTrafico, entradaSalida,
} from '../src/modules/analitica/analitica.controller.js';

function mockReq(overrides = {}) {
  return { query: {}, get: vi.fn().mockReturnValue('Mozilla/5.0 Chrome/120'), ...overrides };
}
function mockRes() {
  return { status: vi.fn().mockReturnThis(), json: vi.fn().mockReturnThis(), end: vi.fn() };
}
const mockNext = vi.fn();

const PAGEVIEW_VALIDO = {
  sessionId: '11111111-1111-1111-1111-111111111111',
  ruta: '/mapas', dispositivo: 'escritorio',
};

describe('analitica.controller → pageview()', () => {
  beforeEach(() => vi.clearAllMocks());

  it('400 con sessionId que no es UUID', async () => {
    const req = mockReq({ body: { ...PAGEVIEW_VALIDO, sessionId: 'no-es-uuid' } });
    const res = mockRes();
    await pageview(req, res, mockNext);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(analiticaService.registrarPageview).not.toHaveBeenCalled();
  });

  it('400 con dispositivo fuera del enum permitido', async () => {
    const req = mockReq({ body: { ...PAGEVIEW_VALIDO, dispositivo: 'smarttv' } });
    const res = mockRes();
    await pageview(req, res, mockNext);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('400 sin ruta', async () => {
    const req = mockReq({ body: { sessionId: PAGEVIEW_VALIDO.sessionId, dispositivo: 'movil' } });
    const res = mockRes();
    await pageview(req, res, mockNext);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('201→204 con body válido, adjunta el user-agent del request', async () => {
    analiticaService.registrarPageview.mockResolvedValue(undefined);
    const req = mockReq({ body: PAGEVIEW_VALIDO });
    const res = mockRes();
    await pageview(req, res, mockNext);
    expect(analiticaService.registrarPageview).toHaveBeenCalledWith(
      expect.objectContaining({ ...PAGEVIEW_VALIDO, userAgent: 'Mozilla/5.0 Chrome/120' }),
    );
    expect(res.status).toHaveBeenCalledWith(204);
    expect(res.end).toHaveBeenCalled();
  });

  it('esAreaAdmin por defecto es false si no se envía', async () => {
    analiticaService.registrarPageview.mockResolvedValue(undefined);
    const req = mockReq({ body: PAGEVIEW_VALIDO });
    const res = mockRes();
    await pageview(req, res, mockNext);
    expect(analiticaService.registrarPageview).toHaveBeenCalledWith(
      expect.objectContaining({ esAreaAdmin: false }),
    );
  });

  it('nunca lee req.user ni lo reenvía al servicio (anónimo incluso con sesión)', async () => {
    analiticaService.registrarPageview.mockResolvedValue(undefined);
    const req = mockReq({ body: PAGEVIEW_VALIDO, user: { id: 'u1', email: 'a@b.com', rol: 'investigador' } });
    const res = mockRes();
    await pageview(req, res, mockNext);
    const argsEnviados = analiticaService.registrarPageview.mock.calls[0][0];
    expect(argsEnviados).not.toHaveProperty('user');
    expect(argsEnviados).not.toHaveProperty('userId');
    expect(argsEnviados).not.toHaveProperty('usuarioId');
  });

  it('llama next(err) cuando el servicio lanza', async () => {
    const err = new Error('DB failure');
    analiticaService.registrarPageview.mockRejectedValue(err);
    const req = mockReq({ body: PAGEVIEW_VALIDO });
    const res = mockRes();
    await pageview(req, res, mockNext);
    expect(mockNext).toHaveBeenCalledWith(err);
  });
});

describe('analitica.controller → endpoints de lectura', () => {
  beforeEach(() => vi.clearAllMocks());

  it('resumen() responde con el resultado del servicio', async () => {
    analiticaService.getResumen.mockResolvedValue({ paginasVistas: {} });
    const res = mockRes();
    await resumen(mockReq(), res, mockNext);
    expect(res.json).toHaveBeenCalledWith({ paginasVistas: {} });
  });

  it('paginasTop() usa rango de fechas por defecto (14 días) sin query params', async () => {
    analiticaService.getPaginasTop.mockResolvedValue([]);
    const res = mockRes();
    await paginasTop(mockReq(), res, mockNext);
    const [{ desde, hasta }] = analiticaService.getPaginasTop.mock.calls[0];
    expect(hasta.getTime() - desde.getTime()).toBeCloseTo(14 * 24 * 60 * 60 * 1000, -3);
  });

  it('paginasTop() respeta ?desde y ?hasta explícitos', async () => {
    analiticaService.getPaginasTop.mockResolvedValue([]);
    const req = mockReq({ query: { desde: '2026-01-01', hasta: '2026-01-10' } });
    const res = mockRes();
    await paginasTop(req, res, mockNext);
    const [{ desde, hasta }] = analiticaService.getPaginasTop.mock.calls[0];
    expect(desde.toISOString().slice(0, 10)).toBe('2026-01-01');
    expect(hasta.toISOString().slice(0, 10)).toBe('2026-01-10');
  });

  it('dispositivos() propaga errores del servicio a next()', async () => {
    const err = new Error('falla');
    analiticaService.getDispositivos.mockRejectedValue(err);
    const res = mockRes();
    await dispositivos(mockReq(), res, mockNext);
    expect(mockNext).toHaveBeenCalledWith(err);
  });

  it('fuentesTrafico() responde con el resultado del servicio', async () => {
    analiticaService.getFuentesTrafico.mockResolvedValue([{ fuente: 'Directo', sesiones: 5 }]);
    const res = mockRes();
    await fuentesTrafico(mockReq(), res, mockNext);
    expect(res.json).toHaveBeenCalledWith([{ fuente: 'Directo', sesiones: 5 }]);
  });

  it('entradaSalida() responde con el resultado del servicio', async () => {
    analiticaService.getEntradaSalida.mockResolvedValue({ entradas: [], salidas: [] });
    const res = mockRes();
    await entradaSalida(mockReq(), res, mockNext);
    expect(res.json).toHaveBeenCalledWith({ entradas: [], salidas: [] });
  });
});
