/**
 * Tests unitarios para admin/modulos.service.js — permisos por módulo de admin_sig.
 * Mockea BD y auditLog. Sin supertest. Sin conexión real.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../src/config/database.js', () => ({
  query: vi.fn(),
  getClient: vi.fn(),
}));

vi.mock('../src/utils/auditLog.js', () => ({
  registrarAuditoria: vi.fn(),
}));

import { query } from '../src/config/database.js';
import { registrarAuditoria } from '../src/utils/auditLog.js';
import {
  MODULOS,
  tienePermisoModulo,
  permisosDeAdmin,
  setPermisosAdmin,
} from '../src/modules/admin/modulos.service.js';

describe('modulos.service → tienePermisoModulo()', () => {
  beforeEach(() => vi.clearAllMocks());

  it('super_admin siempre tiene acceso, sin consultar la BD', async () => {
    const result = await tienePermisoModulo({ id: 's1', rol: 'super_admin' }, 'configuracion', 'editar');
    expect(result).toBe(true);
    expect(query).not.toHaveBeenCalled();
  });

  it('roles que no son admin_sig no pasan por el sistema de módulos (siempre true)', async () => {
    const result = await tienePermisoModulo({ id: 'u1', rol: 'investigador' }, 'documentos', 'editar');
    expect(result).toBe(true);
    expect(query).not.toHaveBeenCalled();
  });

  it('retorna false si no hay usuario', async () => {
    const result = await tienePermisoModulo(null, 'mapas', 'ver');
    expect(result).toBe(false);
    expect(query).not.toHaveBeenCalled();
  });

  it('admin_sig sin fila de permiso → deniega por defecto', async () => {
    query.mockResolvedValueOnce({ rows: [] });
    const result = await tienePermisoModulo({ id: 'a1', rol: 'admin_sig' }, 'mapas', 'ver');
    expect(result).toBe(false);
  });

  it('admin_sig con puede_ver=true, puede_editar=false → puede ver pero no editar', async () => {
    query.mockResolvedValueOnce({ rows: [{ puede_ver: true, puede_editar: false }] });
    expect(await tienePermisoModulo({ id: 'a1', rol: 'admin_sig' }, 'mapas', 'ver')).toBe(true);

    query.mockResolvedValueOnce({ rows: [{ puede_ver: true, puede_editar: false }] });
    expect(await tienePermisoModulo({ id: 'a1', rol: 'admin_sig' }, 'mapas', 'editar')).toBe(false);
  });

  it('admin_sig con puede_editar=true → puede editar', async () => {
    query.mockResolvedValueOnce({ rows: [{ puede_ver: true, puede_editar: true }] });
    expect(await tienePermisoModulo({ id: 'a1', rol: 'admin_sig' }, 'mapas', 'editar')).toBe(true);
  });
});

describe('modulos.service → permisosDeAdmin()', () => {
  beforeEach(() => vi.clearAllMocks());

  it('retorna el catálogo completo de módulos, con false por defecto para los no asignados', async () => {
    query.mockResolvedValueOnce({ rows: [{ modulo: 'mapas', puede_ver: true, puede_editar: true }] });

    const result = await permisosDeAdmin('a1');

    expect(result).toHaveLength(MODULOS.length);
    const mapas = result.find((m) => m.modulo === 'mapas');
    expect(mapas).toMatchObject({ puede_ver: true, puede_editar: true });
    const otros = result.filter((m) => m.modulo !== 'mapas');
    expect(otros.every((m) => m.puede_ver === false && m.puede_editar === false)).toBe(true);
  });
});

describe('modulos.service → setPermisosAdmin()', () => {
  beforeEach(() => vi.clearAllMocks());

  it('lanza 404 si el usuario no existe', async () => {
    query.mockResolvedValueOnce({ rows: [] });
    await expect(
      setPermisosAdmin('no-existe', [], { superAdminId: 's1' })
    ).rejects.toMatchObject({ status: 404 });
  });

  it('lanza 400 si el target no es admin_sig', async () => {
    query.mockResolvedValueOnce({ rows: [{ rol: 'investigador' }] });
    await expect(
      setPermisosAdmin('u1', [{ modulo: 'mapas', puede_ver: true }], { superAdminId: 's1' })
    ).rejects.toMatchObject({ status: 400 });
  });

  it('lanza 400 si algún módulo enviado no existe en el catálogo', async () => {
    query.mockResolvedValueOnce({ rows: [{ rol: 'admin_sig' }] });
    await expect(
      setPermisosAdmin('a1', [{ modulo: 'inventado', puede_ver: true }], { superAdminId: 's1' })
    ).rejects.toMatchObject({ status: 400 });
  });

  it('hace upsert de cada permiso y registra auditoría', async () => {
    query
      .mockResolvedValueOnce({ rows: [{ rol: 'admin_sig' }] })  // target check
      .mockResolvedValueOnce({ rows: [] })                       // upsert mapas
      .mockResolvedValueOnce({ rows: [] })                       // upsert documentos
      .mockResolvedValueOnce({ rows: [] });                      // permisosDeAdmin() al final

    await setPermisosAdmin('a1', [
      { modulo: 'mapas', puede_ver: true, puede_editar: true },
      { modulo: 'documentos', puede_ver: true, puede_editar: false },
    ], { superAdminId: 's1' });

    const upsertCalls = query.mock.calls.filter((c) => /INSERT INTO admin_permisos_modulo/i.test(c[0]));
    expect(upsertCalls).toHaveLength(2);
    expect(upsertCalls[0][0]).toMatch(/ON CONFLICT/i);
    expect(registrarAuditoria).toHaveBeenCalledWith(
      expect.objectContaining({ accion: 'update_permisos_modulo', entidadId: 'a1' })
    );
  });

  it('fuerza puede_ver=true cuando puede_editar=true, aunque no se envíe explícito', async () => {
    query
      .mockResolvedValueOnce({ rows: [{ rol: 'admin_sig' }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });

    await setPermisosAdmin('a1', [{ modulo: 'mapas', puede_ver: false, puede_editar: true }], { superAdminId: 's1' });

    const upsertCall = query.mock.calls.find((c) => /INSERT INTO admin_permisos_modulo/i.test(c[0]));
    expect(upsertCall[1]).toEqual(['a1', 'mapas', true, true]);
  });
});
