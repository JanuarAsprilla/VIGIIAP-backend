/**
 * Tests de integración — cadena de hashes y protección de solo anexado de audit_log.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { cleanDatabase } from './setup.js';
import { query, getClient } from '../../src/config/database.js';
import { verificarIntegridadAuditoria } from '../../src/modules/admin/integridadAuditoria.js';
import { purgarAuditoria } from '../../src/utils/retencionAuditoria.js';

const evento = (accion, { cambios = null, creadoEn = null } = {}) => query(
  `INSERT INTO audit_log (accion, modulo, descripcion, usuario_email, ip, cambios, creado_en)
   VALUES ($1, 'auth', $2, 'ana@iiap.test', '10.0.0.1', $3::jsonb, COALESCE($4::timestamptz, NOW()))`,
  [accion, `Evento ${accion}`, cambios ? JSON.stringify(cambios) : null, creadoEn],
);

/** Ejecuta `fn` con los triggers de usuario desactivados (simula a quien manipula la base a mano). */
async function conTriggersApagados(fn) {
  const cliente = await getClient();
  try {
    await cliente.query('BEGIN');
    await cliente.query('ALTER TABLE audit_log DISABLE TRIGGER USER');
    await fn(cliente);
    await cliente.query('ALTER TABLE audit_log ENABLE TRIGGER USER');
    await cliente.query('COMMIT');
  } catch (err) {
    await cliente.query('ROLLBACK');
    throw err;
  } finally {
    cliente.release();
  }
}

beforeEach(async () => {
  await cleanDatabase();
  await evento('a');
  await evento('b', { cambios: { rol: { antes: 'x', despues: 'y' } } });
  await evento('c');
});

describe('cadena de hashes', () => {
  it('numera los eventos en orden y cada uno apunta al hash del anterior', async () => {
    const { rows } = await query('SELECT secuencia::int AS secuencia, hash, hash_previo FROM audit_log ORDER BY secuencia');

    expect(rows.map((r) => r.secuencia)).toEqual([1, 2, 3]);
    expect(rows[0].hash_previo).toBeNull();
    expect(rows[1].hash_previo).toBe(rows[0].hash);
    expect(rows[2].hash_previo).toBe(rows[1].hash);
  });

  it('una cadena sin tocar se verifica como íntegra', async () => {
    const r = await verificarIntegridadAuditoria();

    expect(r).toMatchObject({ integra: true, verificados: 3, problemas: [] });
  });

  it('inserciones concurrentes quedan encadenadas sin repetir ni saltar números', async () => {
    await Promise.all(['d', 'e', 'f', 'g', 'h'].map((a) => evento(a)));

    const r = await verificarIntegridadAuditoria();
    const { rows } = await query('SELECT secuencia::int AS secuencia FROM audit_log ORDER BY secuencia');

    expect(r.integra).toBe(true);
    expect(rows.map((x) => x.secuencia)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });
});

describe('solo anexado', () => {
  it('rechaza modificar un evento', async () => {
    await expect(query(`UPDATE audit_log SET descripcion = 'otra' WHERE accion = 'a'`)).rejects.toThrow(/solo anexado/);
  });

  it('rechaza borrar un evento fuera de la purga', async () => {
    await expect(query(`DELETE FROM audit_log WHERE accion = 'a'`)).rejects.toThrow(/solo anexado/);
  });

  it('eliminar la cuenta de un usuario sí desvincula sus eventos sin romper la cadena', async () => {
    const { rows } = await query(`
      INSERT INTO usuarios (nombre, email, password_hash, rol, activo, email_verified)
      VALUES ('Ana', 'ana@iiap.test', '$2b$12$dummy', 'investigador', true, true) RETURNING id`);
    await query(`INSERT INTO audit_log (accion, modulo, usuario_id, usuario_email) VALUES ('d', 'auth', $1, 'ana@iiap.test')`, [rows[0].id]);

    await query('DELETE FROM usuarios WHERE id = $1', [rows[0].id]);

    const { rows: nuevo } = await query(`SELECT usuario_id FROM audit_log WHERE accion = 'd'`);
    expect(nuevo[0].usuario_id).toBeNull();
    expect((await verificarIntegridadAuditoria()).integra).toBe(true);
  });
});

describe('detección de manipulación', () => {
  it('detecta un evento cuyo contenido fue editado', async () => {
    await conTriggersApagados((c) => c.query(`UPDATE audit_log SET descripcion = 'adulterado' WHERE accion = 'b'`));

    const r = await verificarIntegridadAuditoria();

    expect(r.integra).toBe(false);
    expect(r.problemas).toHaveLength(1);
    expect(r.problemas[0]).toMatchObject({ secuencia: '2', problema: 'contenido_alterado' });
  });

  it('detecta un evento borrado del medio', async () => {
    await conTriggersApagados((c) => c.query(`DELETE FROM audit_log WHERE accion = 'b'`));

    const r = await verificarIntegridadAuditoria();

    expect(r.integra).toBe(false);
    expect(r.problemas[0]).toMatchObject({ secuencia: '3', problema: 'evento_faltante' });
  });
});

describe('retención', () => {
  it('la purga borra solo los eventos antiguos del comienzo y deja la cadena íntegra', async () => {
    await cleanDatabase();
    await evento('a', { creadoEn: new Date(Date.now() - 900 * 86_400_000).toISOString() });
    await evento('b');
    await evento('c');

    const r = await purgarAuditoria();
    const { rows } = await query('SELECT accion FROM audit_log ORDER BY secuencia');

    expect(r.eventosBorrados).toBe(1);
    expect(rows.map((x) => x.accion)).toEqual(['b', 'c']);
    expect((await verificarIntegridadAuditoria()).integra).toBe(true);
  });
});
