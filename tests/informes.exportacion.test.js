import { describe, it, expect, vi, beforeEach } from 'vitest';

const servicioBio = vi.hoisted(() => ({ registrosParaExportar: vi.fn() }));
const herramientas = vi.hoisted(() => ({ herramientaDisponible: vi.fn() }));
const informes = vi.hoisted(() => ({ configuracionPublica: vi.fn(), tieneCuenta: vi.fn((u) => Boolean(u) && !['visitante', 'publico'].includes(u.rol)) }));
const auditoria = vi.hoisted(() => vi.fn());

vi.mock('../src/modules/biodiversidad/biodiversidad.service.js', () => servicioBio);
vi.mock('../src/modules/herramientas/herramientas.service.js', () => herramientas);
vi.mock('../src/modules/informes/informes.service.js', () => informes);
vi.mock('../src/utils/auditLog.js', () => ({ registrarAuditoria: auditoria }));

import {
  decidirPermiso, registrosBiodiversidad, MAXIMO_SIMULTANEAS, _simultaneas,
} from '../src/modules/informes/exportacion.controller.js';
import { ConsultaInvalida } from '../src/modules/biodiversidad/biodiversidad.errores.js';

const config = (extra = {}) => ({ habilitado: true, puedeDescargar: true, formatos: ['pdf', 'xlsx'], maxFilas: 5000, ...extra });
const CUENTA = { id: 'u-1', email: 'ana@example.com', rol: 'investigador' };

function respuesta() {
  const res = { statusCode: 200, body: undefined, headers: {} };
  res.status = vi.fn((c) => { res.statusCode = c; return res; });
  res.json = vi.fn((b) => { res.body = b; return res; });
  res.set = vi.fn((k, v) => { res.headers[k] = v; return res; });
  return res;
}
const peticion = (extra = {}) => ({ user: CUENTA, ip: '127.0.0.1', query: { grupo: 'anfibios' }, ...extra });
const RESULTADO = { grupo: 'anfibios', desde: 2000, hasta: 2025, limite: 5000, truncado: false, registros: [{ gbif_id: 'g1' }, { gbif_id: 'g2' }] };

beforeEach(() => {
  vi.clearAllMocks();
  _simultaneas.reiniciar();
  herramientas.herramientaDisponible.mockResolvedValue(true);
  informes.configuracionPublica.mockResolvedValue(config());
  servicioBio.registrosParaExportar.mockResolvedValue(RESULTADO);
});

describe('decidirPermiso', () => {
  it('con informe habilitado, permiso y un formato de datos devuelve el tope de filas', () => {
    expect(decidirPermiso(config({ maxFilas: 1234 }), CUENTA)).toEqual({ maxFilas: 1234 });
    expect(decidirPermiso(config({ formatos: ['csv'] }), CUENTA)).toEqual({ maxFilas: 5000 });
  });

  it('un informe apagado o inexistente es un 404', () => {
    expect(decidirPermiso(config({ habilitado: false }), CUENTA)).toMatchObject({ status: 404 });
    expect(decidirPermiso(null, CUENTA)).toMatchObject({ status: 404 });
  });

  it('sin permiso: 401 si no hay cuenta (anónimo o visitante) y 403 si la hay', () => {
    const sin = config({ puedeDescargar: false });
    expect(decidirPermiso(sin, null)).toMatchObject({ status: 401 });
    expect(decidirPermiso(sin, { id: 'v', rol: 'visitante' })).toMatchObject({ status: 401 });
    expect(decidirPermiso(sin, CUENTA)).toMatchObject({ status: 403 });
  });

  it('si solo se ofrece PDF no hay descarga de datos', () => {
    expect(decidirPermiso(config({ formatos: ['pdf'] }), CUENTA)).toMatchObject({ status: 403, error: expect.stringMatching(/descarga de datos/) });
  });
});

describe('registrosBiodiversidad', () => {
  it('entrega los registros con el tope configurado, sin caché, y deja rastro en la auditoría', async () => {
    informes.configuracionPublica.mockResolvedValue(config({ maxFilas: 777 }));
    const res = respuesta();
    await registrosBiodiversidad(peticion({ query: { grupo: 'anfibios', familia: 'Bufonidae' } }), res, vi.fn());
    expect(servicioBio.registrosParaExportar).toHaveBeenCalledWith({ grupo: 'anfibios', familia: 'Bufonidae' }, 777);
    expect(res.headers['Cache-Control']).toBe('no-store');
    expect(res.body).toEqual(RESULTADO);
    expect(auditoria).toHaveBeenCalledWith(expect.objectContaining({
      accion: 'informe_registros', modulo: 'informes', entidadId: 'biodiversidad', usuarioId: 'u-1', descripcion: expect.stringContaining('2'),
    }));
  });

  it('la auditoría avisa cuando la descarga se recortó al tope', async () => {
    servicioBio.registrosParaExportar.mockResolvedValue({ ...RESULTADO, truncado: true });
    await registrosBiodiversidad(peticion(), respuesta(), vi.fn());
    expect(auditoria).toHaveBeenCalledWith(expect.objectContaining({ descripcion: expect.stringContaining('recortada') }));
  });

  it('herramienta apagada para esta persona: 404 sin consultar nada más', async () => {
    herramientas.herramientaDisponible.mockResolvedValue(false);
    const res = respuesta();
    await registrosBiodiversidad(peticion(), res, vi.fn());
    expect(res.statusCode).toBe(404);
    expect(servicioBio.registrosParaExportar).not.toHaveBeenCalled();
  });

  it('sin permiso responde 401 o 403 y no consulta los datos', async () => {
    informes.configuracionPublica.mockResolvedValue(config({ puedeDescargar: false }));
    const anonimo = respuesta();
    await registrosBiodiversidad(peticion({ user: undefined }), anonimo, vi.fn());
    expect(anonimo.statusCode).toBe(401);
    const cuenta = respuesta();
    await registrosBiodiversidad(peticion(), cuenta, vi.fn());
    expect(cuenta.statusCode).toBe(403);
    expect(servicioBio.registrosParaExportar).not.toHaveBeenCalled();
    expect(auditoria).not.toHaveBeenCalled();
  });

  it('un filtro que el esquema no admite llega al manejador de errores como validación, antes de tocar la base', async () => {
    const siguiente = vi.fn();
    await registrosBiodiversidad(peticion({ query: { grupo: 'anfibios', pagina: '2', tamano: '5', orden: 'especie' } }), respuesta(), siguiente);
    expect(siguiente).toHaveBeenCalledWith(expect.objectContaining({ name: 'ZodError' }));
    expect(servicioBio.registrosParaExportar).not.toHaveBeenCalled();
  });

  it('un grupo sin datos es 404 y uno solo agregado, el error de la consulta', async () => {
    servicioBio.registrosParaExportar.mockResolvedValueOnce(null);
    const sinDatos = respuesta();
    await registrosBiodiversidad(peticion(), sinDatos, vi.fn());
    expect(sinDatos.statusCode).toBe(404);

    servicioBio.registrosParaExportar.mockRejectedValueOnce(new ConsultaInvalida('Este grupo solo tiene inventario agregado.'));
    const agregado = respuesta();
    await registrosBiodiversidad(peticion(), agregado, vi.fn());
    expect(agregado.statusCode).toBe(422);
    expect(agregado.body.error).toMatch(/agregado/);
  });

  it('si la consulta tarda más del tope responde 503 sin exponer la base', async () => {
    servicioBio.registrosParaExportar.mockRejectedValueOnce(Object.assign(new Error('canceling statement'), { code: '57014' }));
    const res = respuesta();
    await registrosBiodiversidad(peticion(), res, vi.fn());
    expect(res.statusCode).toBe(503);
    expect(JSON.stringify(res.body)).not.toMatch(/statement/);
  });

  it('un error inesperado llega al manejador y libera su lugar', async () => {
    servicioBio.registrosParaExportar.mockRejectedValueOnce(new Error('boom'));
    const siguiente = vi.fn();
    await registrosBiodiversidad(peticion(), respuesta(), siguiente);
    expect(siguiente).toHaveBeenCalledWith(expect.any(Error));
    expect(_simultaneas.actuales()).toBe(0);
  });

  it('no atiende más exportaciones simultáneas que el máximo y libera el lugar al terminar', async () => {
    const pendientes = [];
    servicioBio.registrosParaExportar.mockImplementation(() => new Promise((resolver) => { pendientes.push(resolver); }));
    const enCurso = Array.from({ length: MAXIMO_SIMULTANEAS }, () => registrosBiodiversidad(peticion(), respuesta(), vi.fn()));
    await vi.waitFor(() => expect(_simultaneas.actuales()).toBe(MAXIMO_SIMULTANEAS));

    const rechazada = respuesta();
    await registrosBiodiversidad(peticion(), rechazada, vi.fn());
    expect(rechazada.statusCode).toBe(503);
    expect(rechazada.headers['Retry-After']).toBe('15');

    pendientes.forEach((resolver) => resolver(RESULTADO));
    await Promise.all(enCurso);
    expect(_simultaneas.actuales()).toBe(0);
    servicioBio.registrosParaExportar.mockResolvedValue(RESULTADO);
    const aceptada = respuesta();
    await registrosBiodiversidad(peticion(), aceptada, vi.fn());
    expect(aceptada.statusCode).toBe(200);
  });
});
