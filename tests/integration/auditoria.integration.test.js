/**
 * Tests de integración — registro de auditoría (Actividad).
 * Verifica con SQL real la visibilidad, los filtros nuevos y el resumen.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { cleanDatabase } from './setup.js';
import { getAuditLog, getAuditResumen } from '../../src/modules/admin/admin.service.js';
import { query } from '../../src/config/database.js';

const UA_CHROME_MAC = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/126.0.0.0 Safari/537.36';

let superId, adminId;

async function evento({ accion, modulo = 'auth', usuarioId = null, email = null, ip = '203.0.113.10', ua = null, descripcion = accion }) {
  await query(
    `INSERT INTO audit_log (accion, modulo, descripcion, usuario_id, usuario_email, ip, user_agent)
     VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [accion, modulo, descripcion, usuarioId, email, ip, ua],
  );
}

beforeEach(async () => {
  await cleanDatabase();
  const { rows: s } = await query(`
    INSERT INTO usuarios (nombre, email, password_hash, rol, activo, email_verified)
    VALUES ('Super', 'super@iiap.test', '$2b$12$dummy', 'super_admin', true, true) RETURNING id`);
  superId = s[0].id;
  const { rows: a } = await query(`
    INSERT INTO usuarios (nombre, email, password_hash, rol, activo, email_verified)
    VALUES ('Admin', 'admin@iiap.test', '$2b$12$dummy', 'admin_sig', true, true) RETURNING id`);
  adminId = a[0].id;

  await evento({ accion: 'update_rol', modulo: 'usuarios', usuarioId: superId, email: 'super@iiap.test', ua: UA_CHROME_MAC });
  await evento({ accion: 'create_mapa', modulo: 'mapas', usuarioId: adminId, email: 'admin@iiap.test', ip: '186.96.117.11' });
  await evento({ accion: 'login_visitante', descripcion: 'Acceso visitante — anónimo' });
  await evento({ accion: 'login_failed', descripcion: 'Login fallido — cuenta inexistente (ab***@iiap.test)' });
  await evento({ accion: 'login_blocked', usuarioId: adminId, email: 'admin@iiap.test' });
  await evento({ accion: 'delete_documento', modulo: 'documentos', usuarioId: adminId, email: 'admin@iiap.test' });
});

describe('visibilidad del registro', () => {
  it('un admin_sig no ve la actividad del super_admin pero SÍ los eventos sin usuario', async () => {
    const { data } = await getAuditLog({}, 'admin_sig');
    const acciones = data.map((e) => e.accion);

    expect(acciones).not.toContain('update_rol');
    expect(acciones).toEqual(expect.arrayContaining(['login_visitante', 'login_failed', 'create_mapa']));
  });

  it('un super_admin lo ve todo', async () => {
    const { data, meta } = await getAuditLog({}, 'super_admin');

    expect(meta.total).toBe(6);
    expect(data.map((e) => e.accion)).toContain('update_rol');
  });
});

describe('filtros', () => {
  it('por gravedad crítica devuelve solo acciones críticas', async () => {
    const { data } = await getAuditLog({ severidad: 'critica' }, 'super_admin');

    expect(data.map((e) => e.accion).sort()).toEqual(['login_blocked', 'update_rol']);
  });

  it('por gravedad advertencia incluye fallos de acceso y eliminaciones, y excluye las críticas', async () => {
    const { data } = await getAuditLog({ severidad: 'advertencia' }, 'super_admin');

    expect(data.map((e) => e.accion).sort()).toEqual(['delete_documento', 'login_failed']);
  });

  it('por gravedad info devuelve el resto', async () => {
    const { data } = await getAuditLog({ severidad: 'info' }, 'super_admin');

    expect(data.map((e) => e.accion).sort()).toEqual(['create_mapa', 'login_visitante']);
  });

  it('por usuario (parcial) y por IP (prefijo)', async () => {
    const porUsuario = await getAuditLog({ usuario: 'admin@' }, 'super_admin');
    const porIp = await getAuditLog({ ip: '186.96' }, 'super_admin');

    expect(porUsuario.data.every((e) => e.usuario_email === 'admin@iiap.test')).toBe(true);
    expect(porIp.data.map((e) => e.accion)).toEqual(['create_mapa']);
  });

  it('el total respeta los filtros nuevos (consulta de conteo)', async () => {
    const { meta } = await getAuditLog({ severidad: 'critica' }, 'super_admin');

    expect(meta.total).toBe(2);
  });
});

describe('enriquecimiento de cada evento', () => {
  it('trae gravedad y datos del navegador', async () => {
    const { data } = await getAuditLog({ accion: 'update_rol' }, 'super_admin');

    expect(data[0]).toMatchObject({ severidad: 'critica', navegador: 'Chrome', sistema: 'macOS', dispositivo: 'escritorio' });
  });
});

describe('resumen de 24 horas', () => {
  it('cuenta eventos, fallos, bloqueos, críticos, IPs y usuarios activos', async () => {
    const r = await getAuditResumen('super_admin');

    expect(r).toMatchObject({
      eventos24h: 6, loginsFallidos24h: 1, bloqueos24h: 1, criticos24h: 2, usuariosActivos24h: 2,
    });
    expect(r.ipsDistintas24h).toBe(2);
  });

  it('para un admin_sig no cuenta lo del super_admin', async () => {
    const r = await getAuditResumen('admin_sig');

    expect(r.eventos24h).toBe(5);
    expect(r.criticos24h).toBe(1);
  });
});
