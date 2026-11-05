/**
 * Tests de integración — privacidad contra PostgreSQL real. Los unitarios simulan la base y no pueden
 * comprobar la migración 068 ni que el SQL de exportar y eliminar la cuenta sea válido.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import bcrypt from 'bcryptjs';
import { cleanDatabase } from './setup.js';
import { query } from '../../src/config/database.js';
import { exportarMisDatos, eliminarMiCuenta, FRASE_CONFIRMACION } from '../../src/modules/privacidad/cuenta.service.js';
import { purgarRegistros } from '../../src/utils/retencionDatos.js';

vi.mock('../../src/config/r2.js', () => ({ deleteFileByUrl: vi.fn().mockResolvedValue(undefined) }));

const CLAVE = 'Correcta-123!';

async function crearUsuario({ email, rol = 'investigador', conClave = true } = {}) {
  const hash = conClave ? await bcrypt.hash(CLAVE, 4) : null;
  const { rows } = await query(
    `INSERT INTO usuarios (nombre, email, password_hash, rol, activo, email_verified, institucion, motivo_acceso)
     VALUES ('Ana Investigadora', $1, $2, $3, true, true, 'Universidad', 'Investigación') RETURNING id`,
    [email, hash, rol],
  );
  return rows[0].id;
}

beforeEach(async () => {
  await cleanDatabase();
  await query('TRUNCATE TABLE correos_pendientes, notificaciones, usuario_notificacion_prefs RESTART IDENTITY CASCADE');
});

describe('migración 069', () => {
  it('ninguna clave foránea de una sola columna hacia usuarios queda sin ON DELETE: borrar un administrador con contenido ya no falla', async () => {
    const { rows } = await query(
      `SELECT c.conrelid::regclass::text AS tabla, c.conname
       FROM pg_constraint c JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = c.conkey[1]
       WHERE c.contype = 'f' AND c.confrelid = 'usuarios'::regclass AND c.confdeltype = 'a'
         AND array_length(c.conkey, 1) = 1 AND NOT a.attnotnull`,
    );
    expect(rows).toEqual([]);
  });

  it('agrega la columna eliminado_en', async () => {
    const { rows } = await query(
      `SELECT 1 FROM information_schema.columns WHERE table_name = 'usuarios' AND column_name = 'eliminado_en'`,
    );
    expect(rows).toHaveLength(1);
  });
});

describe('exportarMisDatos() con SQL real', () => {
  it('reúne los datos de la persona y no incluye secretos', async () => {
    const id = await crearUsuario({ email: 'ana@iiap.test' });
    await query(`INSERT INTO solicitudes (tipo, descripcion, usuario_id) VALUES ('acceso', 'Necesito datos del Atrato', $1)`, [id]);
    await query(`INSERT INTO descarga_log (tipo_recurso, recurso_id, recurso_titulo, usuario_id, usuario_email, ip) VALUES ('mapa', gen_random_uuid(), 'Mapa del Atrato', $1, 'ana@iiap.test', '10.0.0.5')`, [id]);
    await query(`INSERT INTO refresh_tokens (token_hash, usuario_id, expira_en, ip) VALUES ('hash-secreto', $1, NOW() + INTERVAL '1 day', '10.0.0.5')`, [id]);
    await query(`UPDATE usuarios SET terminos_aceptados_en = NOW(), terminos_version = 'abc123' WHERE id = $1`, [id]);

    const datos = await exportarMisDatos(id);

    expect(datos.cuenta).toMatchObject({ email: 'ana@iiap.test', nombre: 'Ana Investigadora' });
    expect(datos.solicitudes[0].descripcion).toBe('Necesito datos del Atrato');
    expect(datos.descargas[0].recurso_titulo).toBe('Mapa del Atrato');
    expect(datos.sesionesActivas).toHaveLength(1);
    expect(datos.cuenta.terminos_version).toBe('abc123');
    const texto = JSON.stringify(datos);
    expect(texto).not.toMatch(/hash-secreto|password_hash|totp_secret/);
  });
});

describe('eliminarMiCuenta() con SQL real', () => {
  async function sembrar(id, email) {
    await query(`INSERT INTO solicitudes (tipo, descripcion, usuario_id) VALUES ('acceso', 'Texto personal', $1)`, [id]);
    await query(`INSERT INTO notificaciones (destinatario_id, tipo, mensaje) VALUES ($1, 'info', 'Hola')`, [id]);
    await query(`INSERT INTO refresh_tokens (token_hash, usuario_id, expira_en) VALUES ('h1', $1, NOW() + INTERVAL '1 day')`, [id]);
    await query(`INSERT INTO descarga_log (tipo_recurso, recurso_id, usuario_id, usuario_email, ip) VALUES ('mapa', gen_random_uuid(), $1, $2, '10.0.0.5')`, [id, email]);
    await query(`INSERT INTO geo_custodia (tipo_recurso, recurso_id, accion, usuario_id, usuario_email, ip) VALUES ('mapa', gen_random_uuid(), 'descarga', $1, $2, '10.0.0.5')`, [id, email]);
    await query(`INSERT INTO file_scan_log (archivo_key, sha256_hash, uploaded_by, ip_origen) VALUES ('k', $2, $1, '10.0.0.5')`, [id, 'a'.repeat(64)]);
    await query(`INSERT INTO correos_pendientes (destinatario, asunto) VALUES ($1, 'Aviso')`, [email]);
    await query(`UPDATE usuarios SET terminos_aceptados_en = NOW(), terminos_version = 'abc123' WHERE id = $1`, [id]);
  }

  it('anonimiza la cuenta, borra lo personal y conserva los registros sin lo que identifica', async () => {
    const id = await crearUsuario({ email: 'ana@iiap.test' });
    await sembrar(id, 'ana@iiap.test');

    await expect(eliminarMiCuenta({ usuarioId: id, confirmacion: FRASE_CONFIRMACION, password: CLAVE })).resolves.toEqual({ eliminada: true });

    const { rows: [u] } = await query('SELECT * FROM usuarios WHERE id = $1', [id]);
    expect(u).toMatchObject({
      nombre: 'Cuenta eliminada', email: `eliminado-${id}@cuenta-eliminada.invalid`, password_hash: null,
      institucion: null, motivo_acceso: null, activo: false, rol: 'publico',
    });
    expect(u.eliminado_en).toBeInstanceOf(Date);

    const cuenta = async (sql) => Number((await query(sql, [id])).rows[0].n);
    expect(await cuenta('SELECT COUNT(*) AS n FROM solicitudes WHERE usuario_id = $1')).toBe(0);
    expect(await cuenta('SELECT COUNT(*) AS n FROM notificaciones WHERE destinatario_id = $1')).toBe(0);
    expect(await cuenta('SELECT COUNT(*) AS n FROM refresh_tokens WHERE usuario_id = $1')).toBe(0);
    expect((await query('SELECT COUNT(*) AS n FROM correos_pendientes')).rows[0].n).toBe('0');

    const { rows: [dl] } = await query('SELECT usuario_email, ip FROM descarga_log WHERE usuario_id = $1', [id]);
    expect(dl).toEqual({ usuario_email: null, ip: null });
    const { rows: [gc] } = await query('SELECT usuario_email, ip FROM geo_custodia WHERE usuario_id = $1', [id]);
    expect(gc).toEqual({ usuario_email: null, ip: null });
    const { rows: [fs] } = await query('SELECT ip_origen FROM file_scan_log WHERE uploaded_by = $1', [id]);
    expect(fs.ip_origen).toBeNull();

    // La prueba de la autorización (fecha y versión del texto) se conserva: no identifica a nadie.
    expect(u.terminos_version).toBe('abc123');
    expect(u.terminos_aceptados_en).toBeInstanceOf(Date);
  });

  it('el correo original queda libre: otra persona puede registrarse con él', async () => {
    const id = await crearUsuario({ email: 'ana@iiap.test' });
    await eliminarMiCuenta({ usuarioId: id, confirmacion: FRASE_CONFIRMACION, password: CLAVE });
    await expect(crearUsuario({ email: 'ana@iiap.test' })).resolves.toBeTruthy();
  });

  it('no deja eliminar con contraseña incorrecta, y todo queda intacto', async () => {
    const id = await crearUsuario({ email: 'ana@iiap.test' });
    await sembrar(id, 'ana@iiap.test');

    await expect(eliminarMiCuenta({ usuarioId: id, confirmacion: FRASE_CONFIRMACION, password: 'otra' })).rejects.toMatchObject({ status: 401 });

    const { rows: [u] } = await query('SELECT nombre, eliminado_en FROM usuarios WHERE id = $1', [id]);
    expect(u).toEqual({ nombre: 'Ana Investigadora', eliminado_en: null });
    expect((await query('SELECT COUNT(*) AS n FROM solicitudes WHERE usuario_id = $1', [id])).rows[0].n).toBe('1');
  });

  it('una cuenta administrativa no se autoelimina', async () => {
    const id = await crearUsuario({ email: 'admin@iiap.test', rol: 'admin_sig' });
    await expect(eliminarMiCuenta({ usuarioId: id, confirmacion: FRASE_CONFIRMACION, password: CLAVE })).rejects.toMatchObject({ status: 403 });
    const { rows: [u] } = await query('SELECT eliminado_en FROM usuarios WHERE id = $1', [id]);
    expect(u.eliminado_en).toBeNull();
  });

  it('una cuenta de Google o Microsoft (sin contraseña) se elimina solo con la frase', async () => {
    const id = await crearUsuario({ email: 'oauth@iiap.test', conClave: false });
    await expect(eliminarMiCuenta({ usuarioId: id, confirmacion: FRASE_CONFIRMACION })).resolves.toEqual({ eliminada: true });
  });

  it('eliminar dos veces responde 404 la segunda', async () => {
    const id = await crearUsuario({ email: 'ana@iiap.test' });
    await eliminarMiCuenta({ usuarioId: id, confirmacion: FRASE_CONFIRMACION, password: CLAVE });
    await expect(eliminarMiCuenta({ usuarioId: id, confirmacion: FRASE_CONFIRMACION, password: CLAVE })).rejects.toMatchObject({ status: 404 });
  });

  it('una cuenta eliminada ya no se puede exportar', async () => {
    const id = await crearUsuario({ email: 'ana@iiap.test' });
    await eliminarMiCuenta({ usuarioId: id, confirmacion: FRASE_CONFIRMACION, password: CLAVE });
    await expect(exportarMisDatos(id)).rejects.toMatchObject({ status: 404 });
  });
});

describe('purgarRegistros() con SQL real', () => {
  it('el SQL de todas las purgas es válido y respeta los plazos', async () => {
    process.env.DESCARGAS_RETENCION_DIAS = '730';
    process.env.ESCANEOS_RETENCION_DIAS = '365';
    try {
      const id = await crearUsuario({ email: 'ana@iiap.test' });
      await query(`INSERT INTO refresh_tokens (token_hash, usuario_id, expira_en, creado_en) VALUES ('viejo', $1, NOW() - INTERVAL '60 days', NOW() - INTERVAL '90 days')`, [id]);
      await query(`INSERT INTO refresh_tokens (token_hash, usuario_id, expira_en) VALUES ('vigente', $1, NOW() + INTERVAL '1 day')`, [id]);
      await query(`INSERT INTO visitantes (nombre, creado_en) VALUES ('Antiguo', NOW() - INTERVAL '120 days'), ('Reciente', NOW())`);
      await query(`INSERT INTO descarga_log (tipo_recurso, recurso_id, created_at) VALUES ('mapa', gen_random_uuid(), NOW() - INTERVAL '800 days'), ('mapa', gen_random_uuid(), NOW())`);

      const r = await purgarRegistros();

      expect(r).toMatchObject({ sesiones: 1, visitantes: 1, descargas: 1 });
      expect((await query('SELECT token_hash FROM refresh_tokens')).rows).toEqual([{ token_hash: 'vigente' }]);
      expect((await query('SELECT nombre FROM visitantes')).rows).toEqual([{ nombre: 'Reciente' }]);
      expect((await query('SELECT COUNT(*) AS n FROM descarga_log')).rows[0].n).toBe('1');
    } finally {
      delete process.env.DESCARGAS_RETENCION_DIAS;
      delete process.env.ESCANEOS_RETENCION_DIAS;
    }
  });
});
