/**
 * Tests unitarios para usuarios.service.js
 * Mockea BD y bcryptjs. Sin supertest. Sin conexión real.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../src/config/database.js', () => ({
  query: vi.fn(),
  getClient: vi.fn(),
}));

vi.mock('bcryptjs', () => ({
  default: {
    compare: vi.fn(),
    hash: vi.fn(),
  },
  compare: vi.fn(),
  hash: vi.fn(),
}));

vi.mock('../src/utils/auditLog.js', () => ({
  registrarAuditoria: vi.fn(),
}));

import { query } from '../src/config/database.js';
import bcrypt from 'bcryptjs';
import {
  getAll,
  getProfile,
  updateRol,
  updatePerfil,
  updatePassword,
} from '../src/modules/usuarios/usuarios.service.js';

// ─── Fixture ──────────────────────────────────────────────────────────────────
const USER = {
  id: 'usr-uuid-1',
  nombre: 'Juan Público',
  email: 'juan@iiap.org.co',
  rol: 'publico',
  institucion: 'IIAP',
  activo: true,
  creado_en: new Date().toISOString(),
};

// ─── getProfile() ─────────────────────────────────────────────────────────────
describe('usuarios.service → getProfile()', () => {
  beforeEach(() => vi.clearAllMocks());

  it('retorna el perfil del usuario cuando existe', async () => {
    query.mockResolvedValueOnce({ rows: [USER] });
    const result = await getProfile('usr-uuid-1');
    expect(result.id).toBe('usr-uuid-1');
    expect(result.email).toBe('juan@iiap.org.co');
  });

  it('lanza 404 si el usuario no existe', async () => {
    query.mockResolvedValueOnce({ rows: [] });
    await expect(getProfile('no-existe')).rejects.toMatchObject({ status: 404 });
  });
});

// ─── getAll() ─────────────────────────────────────────────────────────────────
describe('usuarios.service → getAll()', () => {
  beforeEach(() => vi.clearAllMocks());

  it('retorna lista paginada de usuarios', async () => {
    query
      .mockResolvedValueOnce({ rows: [USER] })
      .mockResolvedValueOnce({ rows: [{ count: '1' }] });

    const result = await getAll({});
    expect(result.data).toHaveLength(1);
    expect(result.meta.total).toBe(1);
    expect(result.meta.page).toBe(1);
  });

  it('filtra por rol cuando es válido', async () => {
    query
      .mockResolvedValueOnce({ rows: [USER] })
      .mockResolvedValueOnce({ rows: [{ count: '1' }] });

    await getAll({ rol: 'publico' });
    const params = query.mock.calls[0][1];
    expect(params).toContain('publico');
  });

  it('ignora rol inválido (no se incluye en params)', async () => {
    query
      .mockResolvedValueOnce({ rows: [USER] })
      .mockResolvedValueOnce({ rows: [{ count: '1' }] });

    await getAll({ rol: 'rol_inventado' });
    const params = query.mock.calls[0][1];
    expect(params).not.toContain('rol_inventado');
  });

  it('filtra por activo=true', async () => {
    query
      .mockResolvedValueOnce({ rows: [USER] })
      .mockResolvedValueOnce({ rows: [{ count: '1' }] });

    await getAll({ activo: 'true' });
    const params = query.mock.calls[0][1];
    expect(params).toContain(true);
  });

  it('retorna lista vacía si no hay usuarios', async () => {
    query
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ count: '0' }] });

    const result = await getAll({});
    expect(result.data).toHaveLength(0);
    expect(result.meta.total).toBe(0);
  });
});

// ─── updateRol() ──────────────────────────────────────────────────────────────
describe('usuarios.service → updateRol()', () => {
  beforeEach(() => vi.clearAllMocks());

  it('actualiza el rol cuando es válido', async () => {
    query
      .mockResolvedValueOnce({ rows: [{ ...USER, rol: 'publico' }] })   // SELECT: target check (no super_admin)
      .mockResolvedValueOnce({ rows: [{ ...USER, rol: 'investigador' }] }); // UPDATE
    const result = await updateRol('usr-uuid-1', 'investigador', true);
    expect(result.rol).toBe('investigador');
  });

  it('lanza 400 si el rol es inválido', async () => {
    await expect(
      updateRol('usr-uuid-1', 'rol_inventado', true)
    ).rejects.toMatchObject({ status: 400, message: 'Rol inválido' });
    expect(query).not.toHaveBeenCalled();
  });

  it('lanza 404 si el usuario no existe (rows vacío)', async () => {
    query.mockResolvedValueOnce({ rows: [] });
    await expect(
      updateRol('no-existe', 'publico', true)
    ).rejects.toMatchObject({ status: 404 });
  });

  it('cambia activo junto con el rol', async () => {
    query
      .mockResolvedValueOnce({ rows: [{ ...USER, rol: 'publico' }] })             // SELECT: target check
      .mockResolvedValueOnce({ rows: [{ ...USER, rol: 'tecnico', activo: false }] }); // UPDATE
    const result = await updateRol('usr-uuid-1', 'tecnico', false);
    expect(result.activo).toBe(false);
    const params = query.mock.calls[1][1]; // call[1] es el UPDATE, no el SELECT
    expect(params).toContain(false); // activo=false
  });
});

// ─── updatePerfil() ───────────────────────────────────────────────────────────
describe('usuarios.service → updatePerfil()', () => {
  beforeEach(() => vi.clearAllMocks());

  it('actualiza nombre correctamente', async () => {
    query.mockResolvedValueOnce({
      rows: [{ ...USER, nombre: 'Juan Carlos Público' }],
    });
    const result = await updatePerfil('usr-uuid-1', { nombre: 'Juan Carlos Público' });
    expect(result.nombre).toBe('Juan Carlos Público');
    const params = query.mock.calls[0][1];
    expect(params).toContain('Juan Carlos Público');
  });

  it('actualiza institucion correctamente', async () => {
    query.mockResolvedValueOnce({
      rows: [{ ...USER, institucion: 'Universidad Nacional' }],
    });
    const result = await updatePerfil('usr-uuid-1', { institucion: 'Universidad Nacional' });
    expect(result.institucion).toBe('Universidad Nacional');
  });

  it('actualiza solo los campos definidos (nombre + institucion)', async () => {
    query.mockResolvedValueOnce({
      rows: [{ ...USER, nombre: 'Nuevo Nombre', institucion: 'IIAP' }],
    });
    const result = await updatePerfil('usr-uuid-1', {
      nombre: 'Nuevo Nombre',
      institucion: 'IIAP',
    });
    expect(result.nombre).toBe('Nuevo Nombre');
    expect(result.institucion).toBe('IIAP');
  });

  it('lanza 404 si el usuario no existe', async () => {
    query.mockResolvedValueOnce({ rows: [] });
    await expect(
      updatePerfil('no-existe', { nombre: 'Alguien' })
    ).rejects.toMatchObject({ status: 404 });
  });

  it('maneja campos undefined (no se incluyen en el SET)', async () => {
    query.mockResolvedValueOnce({ rows: [USER] });
    // Solo se pasa institucion; nombre=undefined no debe aparecer en params del SET
    await updatePerfil('usr-uuid-1', { nombre: undefined, institucion: 'IIAP' });
    const sql = query.mock.calls[0][0];
    // nombre no debe estar en el SET porque era undefined
    expect(sql).not.toMatch(/nombre\s*=/);  // evita falso positivo en RETURNING
    expect(sql).toMatch(/institucion/);
  });
});

// ─── updatePassword() (changePassword) ───────────────────────────────────────
describe('usuarios.service → updatePassword()', () => {
  beforeEach(() => vi.clearAllMocks());

  it('cambia la contraseña si la actual es correcta', async () => {
    query
      .mockResolvedValueOnce({ rows: [{ password_hash: '$2a$12$hashedpassword' }] })
      .mockResolvedValueOnce({ rows: [] }); // UPDATE

    bcrypt.compare.mockResolvedValueOnce(true);
    bcrypt.hash.mockResolvedValueOnce('$2a$12$newhashedpassword');

    await expect(
      updatePassword('usr-uuid-1', 'OldPass1!', 'Nueva123!')
    ).resolves.toBeUndefined();

    expect(bcrypt.compare).toHaveBeenCalledWith('OldPass1!', '$2a$12$hashedpassword');
    expect(bcrypt.hash).toHaveBeenCalledWith('Nueva123!', 12);
    expect(query).toHaveBeenCalledTimes(2);
  });

  it('lanza 401 si la contraseña actual es incorrecta', async () => {
    query.mockResolvedValueOnce({ rows: [{ password_hash: '$2a$12$hashedpassword' }] });
    bcrypt.compare.mockResolvedValueOnce(false);

    await expect(
      updatePassword('usr-uuid-1', 'ContraseñaWrong!', 'Nueva123!')
    ).rejects.toMatchObject({ status: 401 });

    // No debe llegar a hacer el UPDATE
    expect(query).toHaveBeenCalledTimes(1);
    expect(bcrypt.hash).not.toHaveBeenCalled();
  });

  it('lanza 404 si el usuario no existe', async () => {
    query.mockResolvedValueOnce({ rows: [] });

    await expect(
      updatePassword('no-existe', 'OldPass1!', 'Nueva123!')
    ).rejects.toMatchObject({ status: 404 });

    expect(bcrypt.compare).not.toHaveBeenCalled();
  });
});
