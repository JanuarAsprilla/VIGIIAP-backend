/**
 * Tests de integración — comportamiento con varias instancias (Postgres real).
 * Cada llamada concurrente a conBloqueo representa una instancia distinta del servicio.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import crypto from 'node:crypto';

vi.mock('../../src/modules/admin/admin.service.js', () => ({
  getReporte: vi.fn(async () => ({})),
  getAdminEmails: vi.fn(async () => ['a@iiap.test', 'b@iiap.test']),
}));
vi.mock('../../src/utils/mailer.js', () => ({
  notifyReporteSemanal: vi.fn(async () => { await new Promise((resolver) => setTimeout(resolver, 150)); }),
}));

import { query } from '../../src/config/database.js';
import { conBloqueo } from '../../src/utils/bloqueoTareas.js';
import { runWeeklyReportCheck } from '../../src/utils/weeklyReportScheduler.js';
import { notifyReporteSemanal } from '../../src/utils/mailer.js';
import { isRevoked, sincronizarRevocados } from '../../src/utils/tokenBlacklist.js';

const LUNES = new Date('2026-01-05T13:00:00Z');
const pausa = (ms) => new Promise((resolver) => setTimeout(resolver, ms));

beforeEach(async () => {
  vi.clearAllMocks();
  await query(`DELETE FROM configuracion WHERE clave IN ('reportesSemanal', 'reportesSemanalUltimoEnvio')`);
  await query(`INSERT INTO configuracion (clave, valor) VALUES ('reportesSemanal', 'true')`);
});

describe('conBloqueo() con PostgreSQL real', () => {
  it('de dos instancias simultáneas solo una ejecuta la tarea', async () => {
    let ejecuciones = 0;
    const tarea = async () => { ejecuciones += 1; await pausa(200); return 'hecho'; };

    const [a, b] = await Promise.all([conBloqueo('prueba_exclusiva', tarea), conBloqueo('prueba_exclusiva', tarea)]);

    expect(ejecuciones).toBe(1);
    expect([a.ejecutada, b.ejecutada].sort()).toEqual([false, true]);
  });

  it('el candado se libera al terminar: la siguiente ejecución sí corre', async () => {
    await conBloqueo('prueba_secuencial', async () => {});

    const r = await conBloqueo('prueba_secuencial', async () => 'otra vez');

    expect(r).toEqual({ ejecutada: true, resultado: 'otra vez' });
  });

  it('el candado se libera aunque la tarea falle', async () => {
    await expect(conBloqueo('prueba_error', async () => { throw new Error('fallo'); })).rejects.toThrow('fallo');

    const r = await conBloqueo('prueba_error', async () => 'recuperada');

    expect(r.ejecutada).toBe(true);
  });

  it('tareas con nombres distintos no se bloquean entre sí', async () => {
    const tarea = async () => { await pausa(150); };

    const [a, b] = await Promise.all([conBloqueo('tarea_uno', tarea), conBloqueo('tarea_dos', tarea)]);

    expect(a.ejecutada && b.ejecutada).toBe(true);
  });
});

describe('informe semanal con dos instancias', () => {
  it('si coinciden el lunes, los administradores reciben el informe una sola vez', async () => {
    const instancia = () => conBloqueo('reporte_semanal', () => runWeeklyReportCheck(LUNES));

    const resultados = await Promise.all([instancia(), instancia()]);

    expect(notifyReporteSemanal).toHaveBeenCalledTimes(2); // un correo por administrador, no cuatro
    expect(resultados.filter((r) => r.ejecutada)).toHaveLength(1);
  });

  it('si la segunda llega cuando la primera ya terminó, ve el último envío y no repite', async () => {
    await conBloqueo('reporte_semanal', () => runWeeklyReportCheck(LUNES));
    expect(notifyReporteSemanal).toHaveBeenCalledTimes(2);

    await conBloqueo('reporte_semanal', () => runWeeklyReportCheck(new Date(LUNES.getTime() + 60_000)));

    expect(notifyReporteSemanal).toHaveBeenCalledTimes(2);
  });
});

describe('revocación de tokens entre instancias', () => {
  it('un token revocado por otra instancia (fila en la tabla) se reconoce tras sincronizar', async () => {
    const token = 'jwt-revocado-por-la-instancia-b';
    const hash = crypto.createHash('sha256').update(token).digest('hex');
    expect(isRevoked(token)).toBe(false);

    await query(
      `INSERT INTO revoked_tokens (token_hash, expires_at) VALUES ($1, NOW() + INTERVAL '1 hour')`,
      [hash],
    );
    await sincronizarRevocados();

    expect(isRevoked(token)).toBe(true);
  });

  it('un token ya vencido en la tabla no entra a la memoria', async () => {
    const token = 'jwt-vencido';
    const hash = crypto.createHash('sha256').update(token).digest('hex');
    await query(
      `INSERT INTO revoked_tokens (token_hash, expires_at) VALUES ($1, NOW() - INTERVAL '1 minute')`,
      [hash],
    );

    await sincronizarRevocados();

    expect(isRevoked(token)).toBe(false);
  });
});
