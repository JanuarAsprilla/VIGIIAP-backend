import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../src/config/database.js', () => ({ query: vi.fn(), getClient: vi.fn() }));

import { query } from '../src/config/database.js';
import {
  crearNotificacion,
  notificarAdmins,
  listar,
  marcarLeida,
  marcarTodasLeidas,
} from '../src/modules/notificaciones/notificaciones.service.js';

beforeEach(() => vi.clearAllMocks());

describe('crearNotificacion()', () => {
  it('inserta una fila para el destinatario indicado', async () => {
    query.mockResolvedValueOnce({ rows: [] });

    await crearNotificacion({
      destinatarioId: 'user-1', tipo: 'solicitud_actualizada', mensaje: 'Tu solicitud cambió', link: '/solicitudes',
    });

    const [sql, params] = query.mock.calls[0];
    expect(sql).toMatch(/INSERT INTO notificaciones/);
    expect(params).toEqual(['user-1', 'solicitud_actualizada', 'Tu solicitud cambió', '/solicitudes']);
  });

  it('link es opcional -- por defecto null', async () => {
    query.mockResolvedValueOnce({ rows: [] });
    await crearNotificacion({ destinatarioId: 'user-1', tipo: 'x', mensaje: 'y' });
    const [, params] = query.mock.calls[0];
    expect(params[3]).toBeNull();
  });
});

describe('notificarAdmins()', () => {
  it('inserta una fila por cada admin activo (fan-out)', async () => {
    query
      .mockResolvedValueOnce({ rows: [{ id: 'admin-1' }, { id: 'admin-2' }] }) // SELECT admins
      .mockResolvedValueOnce({ rows: [] }); // INSERT

    await notificarAdmins({ tipo: 'nueva_solicitud', mensaje: 'Nueva solicitud', link: '/admin/solicitudes' });

    expect(query).toHaveBeenCalledTimes(2);
    const [insertSql, insertParams] = query.mock.calls[1];
    expect(insertSql).toMatch(/INSERT INTO notificaciones/);
    // 2 admins × 4 columnas cada uno
    expect(insertParams).toEqual([
      'admin-1', 'nueva_solicitud', 'Nueva solicitud', '/admin/solicitudes',
      'admin-2', 'nueva_solicitud', 'Nueva solicitud', '/admin/solicitudes',
    ]);
  });

  it('no inserta nada si no hay ningún admin activo', async () => {
    query.mockResolvedValueOnce({ rows: [] });

    await notificarAdmins({ tipo: 'x', mensaje: 'y' });

    expect(query).toHaveBeenCalledTimes(1); // solo el SELECT, ningún INSERT
  });
});

describe('listar()', () => {
  it('devuelve las notificaciones del destinatario, más recientes primero', async () => {
    const rows = [{ id: 'n1', tipo: 'x', mensaje: 'y', link: null, leido_en: null, creado_en: new Date() }];
    query.mockResolvedValueOnce({ rows });

    const result = await listar('user-1');

    expect(result).toEqual(rows);
    const [sql, params] = query.mock.calls[0];
    expect(sql).toMatch(/ORDER BY creado_en DESC/);
    expect(params[0]).toBe('user-1');
  });
});

describe('marcarLeida()', () => {
  it('devuelve true y marca leido_en cuando la notificación pertenece al usuario', async () => {
    query.mockResolvedValueOnce({ rowCount: 1 });

    const result = await marcarLeida('notif-1', 'user-1');

    expect(result).toBe(true);
    const [sql, params] = query.mock.calls[0];
    expect(sql).toMatch(/SET leido_en = NOW\(\)/);
    expect(sql).toMatch(/AND destinatario_id = \$2/);
    expect(params).toEqual(['notif-1', 'user-1']);
  });

  it('devuelve false si la notificación no existe o no pertenece al usuario', async () => {
    query.mockResolvedValueOnce({ rowCount: 0 });

    const result = await marcarLeida('notif-ajena', 'user-1');

    expect(result).toBe(false);
  });
});

describe('marcarTodasLeidas()', () => {
  it('devuelve la cantidad de notificaciones marcadas', async () => {
    query.mockResolvedValueOnce({ rowCount: 3 });

    const result = await marcarTodasLeidas('user-1');

    expect(result).toBe(3);
    const [sql, params] = query.mock.calls[0];
    expect(sql).toMatch(/AND leido_en IS NULL/);
    expect(params).toEqual(['user-1']);
  });
});
