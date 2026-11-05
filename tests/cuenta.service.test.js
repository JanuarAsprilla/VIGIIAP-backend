import { describe, it, expect, vi, beforeEach } from 'vitest';
import bcrypt from 'bcryptjs';

vi.mock('../src/config/database.js', () => ({ query: vi.fn(), getClient: vi.fn() }));
vi.mock('../src/config/r2.js', () => ({ deleteFileByUrl: vi.fn() }));
vi.mock('../src/utils/logger.js', () => ({
  default: { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() },
}));

import { query, getClient } from '../src/config/database.js';
import { deleteFileByUrl } from '../src/config/r2.js';
import { exportarMisDatos, eliminarMiCuenta, FRASE_CONFIRMACION } from '../src/modules/privacidad/cuenta.service.js';

/** Cliente transaccional falso: responde por patrón de SQL y deja el rastro de lo ejecutado. */
function clienteFalso({ usuario, adjuntos = [] }) {
  const ejecutadas = [];
  const cliente = {
    release: vi.fn(),
    query: vi.fn(async (sql) => {
      const texto = String(sql);
      ejecutadas.push(texto.trim().split(/\s+/).slice(0, 3).join(' '));
      if (/FROM usuarios WHERE id = \$1 FOR UPDATE/.test(texto)) return { rows: usuario ? [usuario] : [] };
      if (/FROM solicitud_archivos/.test(texto)) return { rows: adjuntos };
      return { rows: [], rowCount: 0 };
    }),
  };
  getClient.mockResolvedValue(cliente);
  return { cliente, ejecutadas, sql: () => cliente.query.mock.calls.map(([s]) => String(s)) };
}

const USUARIO = { id: 'u1', rol: 'investigador', password_hash: null, avatar_url: null, email: 'ana@iiap.test', eliminado_en: null };

describe('eliminarMiCuenta()', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    deleteFileByUrl.mockResolvedValue(undefined);
  });

  it('exige escribir la frase de confirmación y no abre ninguna transacción sin ella', async () => {
    await expect(eliminarMiCuenta({ usuarioId: 'u1', confirmacion: 'si' })).rejects.toMatchObject({ status: 400 });
    expect(getClient).not.toHaveBeenCalled();
  });

  it('una cuenta administrativa no se autoelimina: se revierte y no se toca nada', async () => {
    const { cliente, sql } = clienteFalso({ usuario: { ...USUARIO, rol: 'admin_sig' } });

    await expect(eliminarMiCuenta({ usuarioId: 'u1', confirmacion: FRASE_CONFIRMACION }))
      .rejects.toMatchObject({ status: 403, code: 'CUENTA_ADMINISTRATIVA' });

    expect(sql().some((s) => /^ROLLBACK/.test(s))).toBe(true);
    expect(sql().some((s) => /UPDATE usuarios/.test(s))).toBe(false);
    expect(cliente.release).toHaveBeenCalledOnce();
  });

  it('una cuenta con contraseña exige la contraseña correcta', async () => {
    const password_hash = await bcrypt.hash('Correcta-123', 4);
    const { sql } = clienteFalso({ usuario: { ...USUARIO, password_hash } });

    await expect(eliminarMiCuenta({ usuarioId: 'u1', confirmacion: FRASE_CONFIRMACION, password: 'incorrecta' }))
      .rejects.toMatchObject({ status: 401 });
    await expect(eliminarMiCuenta({ usuarioId: 'u1', confirmacion: FRASE_CONFIRMACION }))
      .rejects.toMatchObject({ status: 401 });

    expect(sql().some((s) => /UPDATE usuarios/.test(s))).toBe(false);
  });

  it('una cuenta que ya no existe o ya fue eliminada responde 404', async () => {
    clienteFalso({ usuario: null });
    await expect(eliminarMiCuenta({ usuarioId: 'u1', confirmacion: FRASE_CONFIRMACION })).rejects.toMatchObject({ status: 404 });
    clienteFalso({ usuario: { ...USUARIO, eliminado_en: new Date() } });
    await expect(eliminarMiCuenta({ usuarioId: 'u1', confirmacion: FRASE_CONFIRMACION })).rejects.toMatchObject({ status: 404 });
  });

  it('borra lo personal, seudonimiza la custodia, anonimiza la fila y confirma, todo en una transacción', async () => {
    const password_hash = await bcrypt.hash('Correcta-123', 4);
    const { cliente, sql } = clienteFalso({ usuario: { ...USUARIO, password_hash } });

    await expect(eliminarMiCuenta({ usuarioId: 'u1', confirmacion: FRASE_CONFIRMACION, password: 'Correcta-123' }))
      .resolves.toEqual({ eliminada: true });

    const todo = sql().join('\n');
    expect(sql()[0]).toBe('BEGIN');
    expect(sql().at(-1)).toBe('COMMIT');
    for (const patron of [
      /DELETE FROM solicitudes WHERE usuario_id/, /DELETE FROM notificaciones/, /DELETE FROM usuario_notificacion_prefs/,
      /DELETE FROM refresh_tokens/, /DELETE FROM correos_pendientes/,
      /UPDATE descarga_log SET usuario_email = NULL, ip = NULL/, /UPDATE geo_custodia SET usuario_email = NULL, ip = NULL/,
      /UPDATE file_scan_log SET ip_origen = NULL/,
    ]) expect(todo).toMatch(patron);

    const anonimizacion = cliente.query.mock.calls.find(([s]) => /UPDATE usuarios SET/.test(String(s)));
    expect(anonimizacion[0]).toMatch(/password_hash = NULL/);
    expect(anonimizacion[0]).toMatch(/totp_secret = NULL/);
    expect(anonimizacion[0]).toMatch(/eliminado_en = NOW\(\)/);
    expect(anonimizacion[1]).toEqual(['u1', 'eliminado-u1@cuenta-eliminada.invalid']);
    expect(cliente.release).toHaveBeenCalledOnce();
  });

  it('una cuenta de Google o Microsoft (sin contraseña) se elimina con la frase', async () => {
    clienteFalso({ usuario: USUARIO });
    await expect(eliminarMiCuenta({ usuarioId: 'u1', confirmacion: FRASE_CONFIRMACION })).resolves.toEqual({ eliminada: true });
  });

  it('si algo falla a mitad, revierte y propaga el error', async () => {
    const { cliente } = clienteFalso({ usuario: USUARIO });
    cliente.query.mockImplementation(async (sql) => {
      if (/FOR UPDATE/.test(sql)) return { rows: [USUARIO] };
      if (/DELETE FROM notificaciones/.test(sql)) throw new Error('fallo de BD');
      return { rows: [], rowCount: 0 };
    });

    await expect(eliminarMiCuenta({ usuarioId: 'u1', confirmacion: FRASE_CONFIRMACION })).rejects.toThrow('fallo de BD');
    expect(cliente.query.mock.calls.map(([s]) => String(s))).toContain('ROLLBACK');
    expect(cliente.release).toHaveBeenCalledOnce();
    expect(deleteFileByUrl).not.toHaveBeenCalled();
  });

  it('borra del almacenamiento los adjuntos y el avatar solo después de confirmar, y tolera que alguno falle', async () => {
    const orden = [];
    const { cliente } = clienteFalso({
      usuario: { ...USUARIO, avatar_url: 'https://files.test/avatars/a.webp' },
      adjuntos: [{ url: 'https://files.test/solicitudes/1.pdf' }],
    });
    const original = cliente.query.getMockImplementation();
    cliente.query.mockImplementation(async (sql, params) => {
      if (String(sql) === 'COMMIT') orden.push('commit');
      return original(sql, params);
    });
    deleteFileByUrl.mockImplementation(async (url) => {
      orden.push(`borra:${url}`);
      if (url.endsWith('1.pdf')) throw new Error('almacenamiento caído');
    });

    await expect(eliminarMiCuenta({ usuarioId: 'u1', confirmacion: FRASE_CONFIRMACION })).resolves.toEqual({ eliminada: true });

    expect(orden[0]).toBe('commit');
    expect(orden).toContain('borra:https://files.test/avatars/a.webp');
    expect(orden).toContain('borra:https://files.test/solicitudes/1.pdf');
  });
});

describe('exportarMisDatos()', () => {
  beforeEach(() => vi.resetAllMocks());

  it('responde 404 si la cuenta no existe o ya fue eliminada', async () => {
    query.mockResolvedValueOnce({ rows: [] });
    await expect(exportarMisDatos('u1')).rejects.toMatchObject({ status: 404 });
  });

  it('reúne cuenta, solicitudes, adjuntos, sesiones, notificaciones, descargas y actividad', async () => {
    query.mockResolvedValueOnce({ rows: [{ id: 'u1', nombre: 'Ana', email: 'ana@iiap.test' }] });
    for (let i = 0; i < 6; i += 1) query.mockResolvedValueOnce({ rows: [{ seccion: i }] });

    const datos = await exportarMisDatos('u1');

    expect(datos.cuenta).toEqual({ id: 'u1', nombre: 'Ana', email: 'ana@iiap.test' });
    expect(Object.keys(datos)).toEqual(expect.arrayContaining([
      'generadoEn', 'cuenta', 'solicitudes', 'archivosAdjuntos', 'sesionesActivas', 'notificaciones', 'descargas', 'actividad',
    ]));
  });

  it('jamás pide la contraseña, los secretos de 2FA ni los tokens', async () => {
    query.mockResolvedValue({ rows: [{ id: 'u1' }] });
    await exportarMisDatos('u1');
    const sql = query.mock.calls.map(([s]) => String(s)).join('\n');
    expect(sql).not.toMatch(/password_hash|totp_secret|totp_backup_codes|token_hash|reset_token|verification_token/);
    expect(sql).not.toMatch(/sa\.url/); // las ubicaciones internas de los archivos no se exponen
  });
});
