/**
 * Tests de integración — alerta de ubicación nueva con el historial real de la auditoría.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { cleanDatabase } from './setup.js';
import { query } from '../../src/config/database.js';
import { definirProveedorUbicacion } from '../../src/utils/geolocalizacion.js';

vi.mock('../../src/utils/mailer.js', async (importar) => ({
  ...(await importar()),
  notifyAlertaSeguridad: vi.fn().mockResolvedValue(undefined),
}));

import { notifyAlertaSeguridad } from '../../src/utils/mailer.js';
import { evaluarUbicacionNueva } from '../../src/utils/alertasSeguridad.js';

let admin;

beforeEach(async () => {
  vi.clearAllMocks();
  await cleanDatabase();
  const { rows } = await query(`
    INSERT INTO usuarios (nombre, email, password_hash, rol, activo, email_verified)
    VALUES ('Admin', 'admin@iiap.test', '$2b$12$dummy', 'admin_sig', true, true) RETURNING id, email, rol`);
  admin = rows[0];
  definirProveedorUbicacion((ip) => (ip === '1.1.1.1'
    ? { country: 'CO', region: 'CHO', city: 'Quibdó' }
    : { country: 'CO', region: 'VAC', city: 'Cali' }));
});
afterEach(() => definirProveedorUbicacion(undefined));

const loginDesde = (ip, dias = 1) => query(
  `INSERT INTO audit_log (accion, modulo, usuario_id, usuario_email, ip, creado_en)
   VALUES ('login', 'auth', $1, $2, $3, NOW() - make_interval(days => $4))`,
  [admin.id, admin.email, ip, dias],
);

// registrarAuditoria no se espera (no bloquea el login): se deja correr antes de consultar.
const esperarRegistro = () => new Promise((resolver) => setTimeout(resolver, 150));

describe('evaluarUbicacionNueva() con el historial real', () => {
  it('registra el evento cuando el lugar no aparece en los últimos 90 días', async () => {
    await loginDesde('1.1.1.1');

    await evaluarUbicacionNueva(admin, '2.2.2.2');
    await esperarRegistro();

    const { rows } = await query(`SELECT accion, ip, usuario_id FROM audit_log WHERE accion = 'login_ubicacion_nueva'`);
    expect(rows).toEqual([{ accion: 'login_ubicacion_nueva', ip: '2.2.2.2', usuario_id: admin.id }]);
    expect(notifyAlertaSeguridad).toHaveBeenCalledTimes(1);
  });

  it('un lugar visto hace más de 90 días ya no cuenta como conocido', async () => {
    await loginDesde('1.1.1.1', 1);
    await loginDesde('2.2.2.2', 120);

    await evaluarUbicacionNueva(admin, '2.2.2.2');
    await esperarRegistro();

    const { rows } = await query(`SELECT 1 FROM audit_log WHERE accion = 'login_ubicacion_nueva'`);
    expect(rows).toHaveLength(1);
  });

  it('no registra nada desde un lugar ya usado', async () => {
    await loginDesde('1.1.1.1');

    await evaluarUbicacionNueva(admin, '1.1.1.1');
    await esperarRegistro();

    const { rows } = await query(`SELECT 1 FROM audit_log WHERE accion = 'login_ubicacion_nueva'`);
    expect(rows).toHaveLength(0);
  });
});
