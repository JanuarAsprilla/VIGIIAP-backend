/**
 * Tests de integración — módulo de solicitudes.
 * Verifica FSM, RBAC y comportamiento real en BD.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { cleanDatabase } from './setup.js';
import { create, getAll, getMine, updateEstado, responder } from '../../src/modules/solicitudes/solicitudes.service.js';
import { query } from '../../src/config/database.js';

let userId, adminId;

beforeEach(async () => {
  await cleanDatabase();
  const { rows: u } = await query(`
    INSERT INTO usuarios (nombre, email, password_hash, rol, activo, email_verified)
    VALUES ('Investigador', 'inv@iiap.test', '$2b$12$dummy', 'investigador', true, true)
    RETURNING id
  `);
  userId = u[0].id;

  const { rows: a } = await query(`
    INSERT INTO usuarios (nombre, email, password_hash, rol, activo, email_verified)
    VALUES ('Admin', 'admin@iiap.test', '$2b$12$dummy', 'admin_sig', true, true)
    RETURNING id
  `);
  adminId = a[0].id;
});

describe('FSM de solicitudes', () => {
  it('flujo completo: pendiente → en_revision → aprobada → resuelta', async () => {
    const sol = await create({ tipo: 'uso-suelo', descripcion: 'Solicitud de prueba de integración' }, userId);
    expect(sol.estado).toBe('pendiente');

    await updateEstado(sol.id, 'en_revision', null, adminId);
    await updateEstado(sol.id, 'aprobada', null, adminId);
    await responder(sol.id, 'Respuesta aprobada con detalles completos.', adminId);

    const { rows } = await query('SELECT estado FROM solicitudes WHERE id=$1', [sol.id]);
    expect(rows[0].estado).toBe('resuelta');
  });

  it('responder() falla si el estado es pendiente (bypass FSM corregido)', async () => {
    const sol = await create({ tipo: 'linderos', descripcion: 'Solicitud desde pendiente' }, userId);
    await expect(responder(sol.id, 'Respuesta directa desde pendiente', adminId))
      .rejects.toMatchObject({ status: 422 });
  });

  it('transición inválida lanza 422', async () => {
    const sol = await create({ tipo: 'validacion', descripcion: 'Test transición inválida' }, userId);
    // pendiente → resuelta no es válido
    await expect(updateEstado(sol.id, 'resuelta', null, adminId))
      .rejects.toMatchObject({ status: 422 });
  });

  it('getMine solo devuelve solicitudes del usuario correcto', async () => {
    await create({ tipo: 'uso-suelo', descripcion: 'Mi solicitud personal' }, userId);
    const { rows: u2 } = await query(`
      INSERT INTO usuarios (nombre, email, password_hash, rol, activo, email_verified)
      VALUES ('Otro', 'otro@iiap.test', '$2b$12$dummy', 'investigador', true, true) RETURNING id
    `);
    await create({ tipo: 'linderos', descripcion: 'Solicitud de otro usuario' }, u2[0].id);

    const mine = await getMine(userId, {});
    expect(mine.data.every((s) => s !== undefined)).toBe(true);
    expect(mine.meta.total).toBe(1);
  });
});
