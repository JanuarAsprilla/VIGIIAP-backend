import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../src/config/database.js', () => ({ query: vi.fn(), getClient: vi.fn() }));

import { query } from '../src/config/database.js';
import { listar, crear, actualizar, desactivar } from '../src/modules/notificaciones/tiposNotificacion.service.js';

beforeEach(() => vi.clearAllMocks());

describe('listar()', () => {
  it('filtra por activo=true por defecto', async () => {
    query.mockResolvedValueOnce({ rows: [{ clave: 'nuevo_usuario' }] });

    const result = await listar();

    expect(result).toEqual([{ clave: 'nuevo_usuario' }]);
    expect(query.mock.calls[0][0]).toMatch(/WHERE activo = true/);
  });

  it('sin filtro cuando soloActivos=false', async () => {
    query.mockResolvedValueOnce({ rows: [] });
    await listar({ soloActivos: false });
    expect(query.mock.calls[0][0]).not.toMatch(/WHERE activo = true/);
  });
});

describe('crear()', () => {
  it('inserta el tipo y devuelve la fila creada', async () => {
    const fila = { clave: 'anuncio', nombre: 'Anuncio', icono: 'Megaphone', color: 'primary', aplica_a: 'ambos', activo: true, orden: 5 };
    query.mockResolvedValueOnce({ rows: [fila] });

    const result = await crear({ clave: 'anuncio', nombre: 'Anuncio', icono: 'Megaphone', color: 'primary', aplicaA: 'ambos', orden: 5 });

    expect(result).toEqual(fila);
    const [sql, params] = query.mock.calls[0];
    expect(sql).toMatch(/INSERT INTO tipos_notificacion/);
    expect(params).toEqual(['anuncio', 'Anuncio', 'Megaphone', 'primary', 'ambos', 5]);
  });
});

describe('actualizar()', () => {
  it('actualiza solo los campos provistos', async () => {
    query.mockResolvedValueOnce({ rows: [{ clave: 'nuevo_usuario', nombre: 'Nuevo nombre' }] });

    const result = await actualizar('nuevo_usuario', { nombre: 'Nuevo nombre' });

    expect(result).toEqual({ clave: 'nuevo_usuario', nombre: 'Nuevo nombre' });
    const [sql, params] = query.mock.calls[0];
    expect(sql).toMatch(/SET nombre = \$1/);
    expect(params).toEqual(['Nuevo nombre', 'nuevo_usuario']);
  });

  it('lanza 400 si no hay cambios', async () => {
    await expect(actualizar('nuevo_usuario', {})).rejects.toMatchObject({ status: 400 });
    expect(query).not.toHaveBeenCalled();
  });

  it('lanza 404 si la clave no existe', async () => {
    query.mockResolvedValueOnce({ rows: [] });
    await expect(actualizar('inexistente', { nombre: 'X' })).rejects.toMatchObject({ status: 404 });
  });
});

describe('desactivar()', () => {
  it('marca activo=false', async () => {
    query.mockResolvedValueOnce({ rowCount: 1 });
    await desactivar('nuevo_usuario');
    const [sql, params] = query.mock.calls[0];
    expect(sql).toMatch(/SET activo = false/);
    expect(params).toEqual(['nuevo_usuario']);
  });

  it('lanza 404 si la clave no existe', async () => {
    query.mockResolvedValueOnce({ rowCount: 0 });
    await expect(desactivar('inexistente')).rejects.toMatchObject({ status: 404 });
  });
});
