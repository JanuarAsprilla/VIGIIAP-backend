/**
 * Tests unitarios para conexionesGeoserver.service.js — CRUD + proxy de vista
 * previa por conexión (constructor de geovisores).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../src/config/database.js', () => ({
  query: vi.fn(),
  getClient: vi.fn(),
}));
vi.mock('../src/utils/geoserverEncryption.js', () => ({
  encryptGeoserverPassword: vi.fn((p) => `enc:${p}`),
  decryptGeoserverPassword: vi.fn((p) => p.replace('enc:', '')),
}));
vi.mock('../src/modules/geovisores/geoserver.connector.js', () => ({
  proxyWms: vi.fn(),
  proxyLeyenda: vi.fn(),
}));

import { query } from '../src/config/database.js';
import * as geoserver from '../src/modules/geovisores/geoserver.connector.js';
import {
  getAll, getById, obtenerConexionParaConector, proxyWmsDeConexion, proxyLeyendaDeConexion,
} from '../src/modules/geovisores/conexionesGeoserver.service.js';

const FILA = {
  id: 'conexion-uuid-1', url: 'https://geoserver.test.local/geoserver',
  usuario_lectura: 'lector', password_cifrado: 'enc:secreto', timeout_ms: 20000, activo: true,
};

beforeEach(() => {
  vi.mocked(query).mockReset();
  vi.mocked(geoserver.proxyWms).mockReset();
  vi.mocked(geoserver.proxyLeyenda).mockReset();
});

describe('conexionesGeoserver.service → getAll() / getById()', () => {
  it('getAll nunca selecciona password_cifrado', async () => {
    query.mockResolvedValueOnce({ rows: [] });
    await getAll();
    expect(query.mock.calls[0][0]).not.toMatch(/password_cifrado/);
  });

  it('getById lanza 404 si no existe', async () => {
    query.mockResolvedValueOnce({ rows: [] });
    await expect(getById('no-existe')).rejects.toMatchObject({ status: 404 });
  });
});

describe('conexionesGeoserver.service → obtenerConexionParaConector()', () => {
  it('descifra la contraseña y mapea a camelCase para el conector', async () => {
    query.mockResolvedValueOnce({ rows: [FILA] });
    const result = await obtenerConexionParaConector('conexion-uuid-1');
    expect(result).toMatchObject({
      id: 'conexion-uuid-1', usuarioLectura: 'lector', passwordDescifrada: 'secreto', timeoutMs: 20000,
    });
  });

  it('lanza 404 si la conexión no existe', async () => {
    query.mockResolvedValueOnce({ rows: [] });
    await expect(obtenerConexionParaConector('no-existe')).rejects.toMatchObject({ status: 404 });
  });

  it('lanza 503 si la conexión está desactivada', async () => {
    query.mockResolvedValueOnce({ rows: [{ ...FILA, activo: false }] });
    await expect(obtenerConexionParaConector('conexion-uuid-1')).rejects.toMatchObject({ status: 503 });
  });
});

describe('conexionesGeoserver.service → proxyWmsDeConexion() / proxyLeyendaDeConexion()', () => {
  it('proxyWmsDeConexion resuelve la conexión y delega al conector sin restricción de capas', async () => {
    query.mockResolvedValueOnce({ rows: [FILA] });
    const respuestaFalsa = { status: 200, headers: new Map(), arrayBuffer: async () => new ArrayBuffer(0) };
    geoserver.proxyWms.mockResolvedValueOnce(respuestaFalsa);

    const params = new URLSearchParams({ layers: 't_20_hidrologia:rios' });
    const result = await proxyWmsDeConexion('conexion-uuid-1', params, undefined);

    expect(result).toBe(respuestaFalsa);
    expect(geoserver.proxyWms).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'conexion-uuid-1' }), params, undefined,
    );
  });

  it('proxyWmsDeConexion propaga 404 si la conexión no existe', async () => {
    query.mockResolvedValueOnce({ rows: [] });
    await expect(proxyWmsDeConexion('no-existe', new URLSearchParams(), undefined)).rejects.toMatchObject({ status: 404 });
    expect(geoserver.proxyWms).not.toHaveBeenCalled();
  });

  it('proxyLeyendaDeConexion resuelve la conexión y delega al conector', async () => {
    query.mockResolvedValueOnce({ rows: [FILA] });
    const respuestaFalsa = { status: 200, headers: new Map(), arrayBuffer: async () => new ArrayBuffer(0) };
    geoserver.proxyLeyenda.mockResolvedValueOnce(respuestaFalsa);

    const result = await proxyLeyendaDeConexion('conexion-uuid-1', 't_20_hidrologia:rios');

    expect(result).toBe(respuestaFalsa);
    expect(geoserver.proxyLeyenda).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'conexion-uuid-1' }), 't_20_hidrologia:rios',
    );
  });
});
