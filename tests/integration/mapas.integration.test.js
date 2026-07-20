/**
 * Tests de integración — módulo de mapas.
 * Verifica queries SQL reales contra PostgreSQL, incluyendo índices y constraints.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { cleanDatabase } from './setup.js';
import { create, getAll, getBySlug, update, remove } from '../../src/modules/mapas/mapas.service.js';
import { query } from '../../src/config/database.js';

const ADMIN_USER = { id: null, rol: 'admin_sig' };

beforeEach(async () => {
  await cleanDatabase();
  // Crear usuario admin de prueba
  const { rows } = await query(`
    INSERT INTO usuarios (nombre, email, password_hash, rol, activo, email_verified)
    VALUES ('Admin Test', 'admin@iiap.test', '$2b$12$dummy', 'admin_sig', true, true)
    RETURNING id
  `);
  ADMIN_USER.id = rows[0].id;
});

describe('create() + getAll()', () => {
  it('crea un mapa y aparece en el listado público', async () => {
    const mapa = await create({
      titulo: 'Mapa de Prueba',
      categoria: 'Biodiversidad',
      visibilidad: 'publico',
    }, ADMIN_USER.id);

    expect(mapa.id).toBeDefined();
    expect(mapa.slug).toContain('mapa-de-prueba');

    const { data } = await getAll({ limit: '10' }, null);
    expect(data.some((m) => m.id === mapa.id)).toBe(true);
  });

  it('mapa inactivo no aparece en listado público', async () => {
    const mapa = await create({ titulo: 'Mapa Inactivo', categoria: 'Test', visibilidad: 'publico' }, ADMIN_USER.id);
    await query('UPDATE mapas SET activo=false WHERE id=$1', [mapa.id]);

    const { data } = await getAll({}, null);
    expect(data.some((m) => m.id === mapa.id)).toBe(false);
  });
});

describe('update() + soft-delete safety', () => {
  it('update() no modifica un mapa eliminado', async () => {
    const mapa = await create({ titulo: 'A Eliminar', categoria: 'Test', visibilidad: 'publico' }, ADMIN_USER.id);
    await remove(mapa.id);

    await expect(update(mapa.id, { titulo: 'Intento Post-Borrado' }))
      .rejects.toMatchObject({ status: 404 });
  });
});

describe('getBySlug()', () => {
  it('visitante no puede ver mapa con visibilidad usuarios', async () => {
    await create({ titulo: 'Solo Usuarios', categoria: 'Test', visibilidad: 'usuarios' }, ADMIN_USER.id);

    await expect(getBySlug('solo-usuarios', { rol: 'visitante' }))
      .rejects.toMatchObject({ status: 404 });
  });
});
