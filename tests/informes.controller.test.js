import { describe, it, expect, vi, beforeEach } from 'vitest';

const servicio = vi.hoisted(() => ({
  FORMATOS: ['pdf', 'xlsx', 'csv'],
  configuracionPublica: vi.fn(),
  obtenerGeneral: vi.fn(),
  listarHerramientas: vi.fn(),
  actualizarGeneral: vi.fn(),
  fijarLogo: vi.fn(),
  actualizarHerramienta: vi.fn(),
}));
const auditoria = vi.hoisted(() => vi.fn());
const borrarArchivo = vi.hoisted(() => vi.fn());

vi.mock('../src/modules/informes/informes.service.js', () => servicio);
vi.mock('../src/utils/auditLog.js', () => ({ registrarAuditoria: auditoria }));
vi.mock('../src/config/r2.js', () => ({ deleteFileByUrl: borrarArchivo }));
vi.mock('../src/utils/logger.js', () => ({ default: { warn: vi.fn(), error: vi.fn(), info: vi.fn() } }));

import * as c from '../src/modules/informes/informes.controller.js';

function respuesta() {
  const res = { statusCode: 200, body: undefined, headers: {} };
  res.status = vi.fn((code) => { res.statusCode = code; return res; });
  res.json = vi.fn((b) => { res.body = b; return res; });
  res.end = vi.fn(() => res);
  res.set = vi.fn((k, v) => { res.headers[k] = v; return res; });
  return res;
}
const admin = { id: 'a-1', email: 'admin@example.com', rol: 'admin_sig' };
const peticion = (extra = {}) => ({ user: admin, ip: '127.0.0.1', body: {}, params: {}, ...extra });

beforeEach(() => {
  vi.clearAllMocks();
  borrarArchivo.mockResolvedValue(undefined);
});

describe('configuracionPublica', () => {
  it('responde la configuración sin cachearla, porque depende de quién pregunta', async () => {
    servicio.configuracionPublica.mockResolvedValue({ habilitado: true });
    const res = respuesta();
    await c.configuracionPublica(peticion({ params: { herramienta: 'biodiversidad' } }), res, vi.fn());
    expect(servicio.configuracionPublica).toHaveBeenCalledWith('biodiversidad', admin);
    expect(res.headers['Cache-Control']).toBe('no-store');
    expect(res.body).toEqual({ habilitado: true });
  });

  it('404 con una clave mal formada o una herramienta que no existe', async () => {
    const res = respuesta();
    await c.configuracionPublica(peticion({ params: { herramienta: '../etc' } }), res, vi.fn());
    expect(res.statusCode).toBe(404);
    servicio.configuracionPublica.mockResolvedValue(null);
    const res2 = respuesta();
    await c.configuracionPublica(peticion({ params: { herramienta: 'nada' } }), res2, vi.fn());
    expect(res2.statusCode).toBe(404);
  });
});

describe('actualizarGeneral', () => {
  it('rechaza colores mal formados, formatos desconocidos o repetidos, acceso inválido y cuerpo vacío', async () => {
    const malos = [{ color_primario: 'verde' }, { formatos: ['doc'] }, { formatos: [] }, { formatos: ['pdf', 'pdf'] }, { acceso: 'todos' }, {}];
    for (const body of malos) {
      const res = respuesta();
      await c.actualizarGeneral(peticion({ body }), res, vi.fn());
      expect(res.statusCode, JSON.stringify(body)).toBe(400);
    }
    expect(servicio.actualizarGeneral).not.toHaveBeenCalled();
  });

  it('guarda, vacía a null los textos en blanco y deja rastro en la auditoría', async () => {
    servicio.actualizarGeneral.mockResolvedValue({ institucion: 'IIAP' });
    const res = respuesta();
    await c.actualizarGeneral(peticion({ body: { institucion: '  IIAP  ', pie: '   ', acceso: 'publico' } }), res, vi.fn());
    expect(servicio.actualizarGeneral).toHaveBeenCalledWith({ institucion: 'IIAP', pie: null, acceso: 'publico' });
    expect(auditoria).toHaveBeenCalledWith(expect.objectContaining({ accion: 'update_informes_general', modulo: 'informes', usuarioId: 'a-1' }));
    expect(res.body).toEqual({ institucion: 'IIAP' });
  });

  it('un campo que el esquema no conoce no llega al servicio', async () => {
    servicio.actualizarGeneral.mockResolvedValue({});
    await c.actualizarGeneral(peticion({ body: { acceso: 'usuarios', logo_url: 'https://malo.example/x.png' } }), respuesta(), vi.fn());
    expect(servicio.actualizarGeneral).toHaveBeenCalledWith({ acceso: 'usuarios' });
  });
});

describe('logo', () => {
  it('sin imagen subida responde 400', async () => {
    const res = respuesta();
    await c.subirLogo(peticion(), res, vi.fn());
    expect(res.statusCode).toBe(400);
    expect(servicio.fijarLogo).not.toHaveBeenCalled();
  });

  it('guarda el nuevo y borra el anterior sin esperar al almacenamiento', async () => {
    servicio.fijarLogo.mockResolvedValue('https://cdn.example.org/informes/viejo.webp');
    const res = respuesta();
    await c.subirLogo(peticion({ body: { logo_url: 'https://cdn.example.org/informes/nuevo.webp' } }), res, vi.fn());
    expect(servicio.fijarLogo).toHaveBeenCalledWith('https://cdn.example.org/informes/nuevo.webp');
    expect(borrarArchivo).toHaveBeenCalledWith('https://cdn.example.org/informes/viejo.webp');
    expect(res.body).toEqual({ logo_url: 'https://cdn.example.org/informes/nuevo.webp' });
    expect(auditoria).toHaveBeenCalledWith(expect.objectContaining({ accion: 'update_informes_logo' }));
  });

  it('un fallo al borrar el archivo viejo no deshace el cambio', async () => {
    servicio.fijarLogo.mockResolvedValue('https://cdn.example.org/informes/viejo.webp');
    borrarArchivo.mockRejectedValue(new Error('almacenamiento caído'));
    const res = respuesta();
    await c.subirLogo(peticion({ body: { logo_url: 'https://cdn.example.org/informes/nuevo.webp' } }), res, vi.fn());
    expect(res.statusCode).toBe(200);
  });

  it('quitar el logo responde 204 y borra el archivo', async () => {
    servicio.fijarLogo.mockResolvedValue('https://cdn.example.org/informes/viejo.webp');
    const res = respuesta();
    await c.quitarLogo(peticion(), res, vi.fn());
    expect(servicio.fijarLogo).toHaveBeenCalledWith(null);
    expect(borrarArchivo).toHaveBeenCalled();
    expect(res.statusCode).toBe(204);
  });
});

describe('actualizarHerramienta', () => {
  it('valida el tope de filas y el nombre de la herramienta', async () => {
    for (const body of [{ max_filas: 10 }, { max_filas: 999999 }, { max_filas: 1.5 }, { formatos: ['exe'] }, {}]) {
      const res = respuesta();
      await c.actualizarHerramienta(peticion({ params: { clave: 'biodiversidad' }, body }), res, vi.fn());
      expect(res.statusCode, JSON.stringify(body)).toBe(400);
    }
    const res = respuesta();
    await c.actualizarHerramienta(peticion({ params: { clave: 'Mala Clave' }, body: { activo: true } }), res, vi.fn());
    expect(res.statusCode).toBe(404);
  });

  it('404 si la herramienta no existe y 200 con auditoría si se guarda', async () => {
    servicio.actualizarHerramienta.mockResolvedValueOnce(null);
    const res = respuesta();
    await c.actualizarHerramienta(peticion({ params: { clave: 'nada' }, body: { activo: true } }), res, vi.fn());
    expect(res.statusCode).toBe(404);

    servicio.actualizarHerramienta.mockResolvedValueOnce({ clave: 'biodiversidad', activo: false });
    const res2 = respuesta();
    await c.actualizarHerramienta(peticion({ params: { clave: 'biodiversidad' }, body: { activo: false, formatos: null } }), res2, vi.fn());
    expect(servicio.actualizarHerramienta).toHaveBeenLastCalledWith('biodiversidad', { activo: false, formatos: null });
    expect(auditoria).toHaveBeenCalledWith(expect.objectContaining({ accion: 'update_informes_herramienta', entidadId: 'biodiversidad' }));
    expect(res2.body).toEqual({ clave: 'biodiversidad', activo: false });
  });
});

describe('errores', () => {
  it('un fallo del servicio llega al manejador de errores', async () => {
    servicio.listarHerramientas.mockRejectedValue(new Error('boom'));
    servicio.obtenerGeneral.mockResolvedValue({});
    const next = vi.fn();
    await c.panel(peticion(), respuesta(), next);
    expect(next).toHaveBeenCalledWith(expect.any(Error));
  });
});
