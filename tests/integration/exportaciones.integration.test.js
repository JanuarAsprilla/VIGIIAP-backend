/**
 * Tests de integración — exportaciones de administración contra PostgreSQL real.
 * Los tests unitarios simulan la base y no detectan columnas inexistentes: aquí cada exportación
 * ejecuta su SQL de verdad. También cubre la transmisión por bloques de más de 10 000 filas.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { cleanDatabase } from './setup.js';
import { query } from '../../src/config/database.js';
import {
  exportUsuarios, exportSolicitudes, exportAudit, exportDescargas,
} from '../../src/modules/admin/export.controller.js';

const SUPER = { id: '00000000-0000-4000-8000-000000000001', email: 'super@iiap.test', rol: 'super_admin' };

/** Respuesta simulada que soporta tanto el envío único (send/json) como la escritura por bloques. */
function resSimulado() {
  const res = {
    estado: 200, cabeceras: {}, cuerpo: '', json: null, headersSent: false, writableEnded: false, destroyed: false,
    setHeader(k, v) { res.cabeceras[k] = v; return res; },
    status(c) { res.estado = c; return res; },
    json(d) { res.datos = d; res.headersSent = true; res.writableEnded = true; return res; },
    send(s) { res.cuerpo += s; res.headersSent = true; res.writableEnded = true; return res; },
    write(s) { res.cuerpo += s; res.headersSent = true; return true; },
    end(s) { if (s) res.cuerpo += s; res.writableEnded = true; return res; },
    on() { return res; },
    once() { return res; },
    destroy() { res.destroyed = true; return res; },
  };
  return res;
}

const lineas = (res) => res.cuerpo.replace(/^﻿/, '').split('\r\n').filter(Boolean);
const llamar = async (exportar, consulta = {}) => {
  const res = resSimulado();
  let error = null;
  await exportar({ query: consulta, user: SUPER, ip: '127.0.0.1' }, res, (e) => { error = e; });
  return { res, error };
};

beforeEach(async () => {
  await cleanDatabase();
  const { rows } = await query(`
    INSERT INTO usuarios (nombre, email, password_hash, rol, activo, email_verified)
    VALUES ('Ana Investigadora', 'ana@iiap.test', '$2b$12$dummy', 'investigador', true, true) RETURNING id`);
  const usuarioId = rows[0].id;
  await query(`INSERT INTO solicitudes (tipo, descripcion, usuario_id) VALUES ('acceso', 'Necesito acceso a datos', $1)`, [usuarioId]);
  await query(
    `INSERT INTO audit_log (accion, modulo, descripcion, usuario_email, ip) VALUES ('login', 'auth', 'Ingreso', 'ana@iiap.test', '10.0.0.5')`,
  );
  await query(
    `INSERT INTO descarga_log (tipo_recurso, recurso_id, recurso_titulo, usuario_id, usuario_email, ip, archivo_url)
     VALUES ('mapa', gen_random_uuid(), 'Mapa del Atrato', $1, 'ana@iiap.test', '10.0.0.5', 'https://archivos.test/atrato.pdf')`,
    [usuarioId],
  );
});

describe('exportaciones existentes con SQL real', () => {
  it('usuarios en CSV, sin campos sensibles', async () => {
    const { res, error } = await llamar(exportUsuarios);

    expect(error).toBeNull();
    expect(res.cuerpo).toContain('ana@iiap.test');
    expect(res.cuerpo).not.toMatch(/password_hash|\$2b\$12/);
  });

  it('solicitudes en CSV', async () => {
    const { res, error } = await llamar(exportSolicitudes);

    expect(error).toBeNull();
    expect(res.cuerpo).toContain('Necesito acceso a datos');
  });

  it('registro de actividad en CSV y en JSON', async () => {
    const csv = await llamar(exportAudit);
    const json = await llamar(exportAudit, { formato: 'json' });

    expect(csv.error).toBeNull();
    expect(csv.res.cuerpo).toContain('Ingreso');
    expect(json.error).toBeNull();
    expect(json.res.datos.some((f) => f.accion === 'login')).toBe(true);
  });

  it('historial de descargas en CSV y en JSON (columnas reales de la tabla)', async () => {
    const csv = await llamar(exportDescargas);
    const json = await llamar(exportDescargas, { formato: 'json' });

    expect(csv.error).toBeNull();
    expect(csv.res.cuerpo).toContain('Mapa del Atrato');
    expect(json.error).toBeNull();
    expect(json.res.datos[0]).toMatchObject({ recurso_titulo: 'Mapa del Atrato', usuario_email: 'ana@iiap.test' });
  });
});

describe('CSV por bloques: más de 10 000 filas', () => {
  const TOTAL = 12_000;

  beforeEach(async () => {
    // generate_series deja TODAS las filas con el mismo creado_en: el caso difícil de la paginación por llave.
    await query(
      `INSERT INTO audit_log (accion, modulo, descripcion, usuario_email, ip)
       SELECT 'login', 'auth', 'Evento ' || g, 'masivo@iiap.test', '10.0.0.9' FROM generate_series(1, $1) g`,
      [TOTAL],
    );
    await query(
      `INSERT INTO descarga_log (tipo_recurso, recurso_id, recurso_titulo, usuario_email, ip)
       SELECT 'documento', gen_random_uuid(), 'Doc ' || g, 'masivo@iiap.test', '10.0.0.9' FROM generate_series(1, $1) g`,
      [TOTAL],
    );
  });

  it('el registro de actividad se exporta completo, sin saltar ni repetir filas aunque compartan fecha', async () => {
    const { res, error } = await llamar(exportAudit, { usuario: 'masivo@' });

    expect(error).toBeNull();
    expect(res.estado).toBe(200);
    const filas = lineas(res);
    expect(filas).toHaveLength(TOTAL + 1); // + encabezado
    const ids = filas.slice(1).map((f) => f.split(',')[0]);
    expect(new Set(ids).size).toBe(TOTAL);
  });

  it('el historial de descargas también se exporta completo', async () => {
    const { res, error } = await llamar(exportDescargas);

    expect(error).toBeNull();
    expect(lineas(res).length).toBe(TOTAL + 2); // encabezado + las masivas + la sembrada
  });

  it('declara el CSV y la descarga como adjunto, con BOM para Excel', async () => {
    const { res } = await llamar(exportAudit, { usuario: 'masivo@' });

    expect(res.cabeceras['Content-Type']).toMatch(/text\/csv/);
    expect(res.cabeceras['Content-Disposition']).toMatch(/attachment; filename="audit-log\.csv"/);
    expect(res.cuerpo.startsWith('﻿')).toBe(true);
  });

  it('en JSON mantiene el tope de 10 000 y orienta hacia el CSV', async () => {
    const { res } = await llamar(exportAudit, { formato: 'json', usuario: 'masivo@' });

    expect(res.estado).toBe(400);
    expect(JSON.stringify(res.datos)).toMatch(/CSV/);
  });
});
