import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../src/config/database.js', () => ({ query: vi.fn() }));
vi.mock('../src/utils/auditLog.js', () => ({ registrarAuditoria: vi.fn() }));
vi.mock('../src/utils/mailer.js', () => ({ notifyAlertaSeguridad: vi.fn().mockResolvedValue(undefined) }));
vi.mock('../src/utils/logger.js', () => ({ default: { warn: vi.fn(), info: vi.fn(), error: vi.fn() } }));
vi.mock('../src/modules/admin/admin.service.js', () => ({ getAdminEmails: vi.fn().mockResolvedValue(['a@iiap.org', 'b@iiap.org']) }));

import { query } from '../src/config/database.js';
import { registrarAuditoria } from '../src/utils/auditLog.js';
import { notifyAlertaSeguridad } from '../src/utils/mailer.js';
import { definirProveedorUbicacion } from '../src/utils/geolocalizacion.js';
import {
  registrarFalloLogin, evaluarUbicacionNueva, reiniciarAlertasSeguridad,
} from '../src/utils/alertasSeguridad.js';

const vaciarPromesas = () => new Promise((resolver) => setImmediate(resolver));

describe('registrarFalloLogin()', () => {
  beforeEach(() => { vi.clearAllMocks(); reiniciarAlertasSeguridad(); });

  it('no alerta por debajo del umbral', async () => {
    for (let i = 0; i < 9; i += 1) registrarFalloLogin('1.2.3.4', 1_000 + i);
    await vaciarPromesas();
    expect(registrarAuditoria).not.toHaveBeenCalled();
  });

  it('al décimo fallo en la ventana registra la alerta y avisa a los administradores', async () => {
    for (let i = 0; i < 10; i += 1) registrarFalloLogin('1.2.3.4', 1_000 + i);
    await vaciarPromesas();

    expect(registrarAuditoria).toHaveBeenCalledWith(expect.objectContaining({
      accion: 'alerta_rafaga_login', modulo: 'seguridad', ip: '1.2.3.4',
    }));
    expect(notifyAlertaSeguridad).toHaveBeenCalledTimes(2);
    expect(notifyAlertaSeguridad).toHaveBeenCalledWith(expect.objectContaining({ email: 'a@iiap.org' }));
  });

  it('una vez alertada, no repite durante la hora siguiente pero sí después', async () => {
    for (let i = 0; i < 12; i += 1) registrarFalloLogin('1.2.3.4', 1_000 + i);
    await vaciarPromesas();
    expect(registrarAuditoria).toHaveBeenCalledTimes(1);

    const mas = 2 * 60 * 60 * 1000;
    for (let i = 0; i < 10; i += 1) registrarFalloLogin('1.2.3.4', mas + i);
    await vaciarPromesas();
    expect(registrarAuditoria).toHaveBeenCalledTimes(2);
  });

  it('los fallos espaciados fuera de la ventana no suman y cada IP cuenta aparte', async () => {
    for (let i = 0; i < 20; i += 1) registrarFalloLogin('1.2.3.4', i * 120_000);
    for (let i = 0; i < 9; i += 1) registrarFalloLogin('9.9.9.9', 1_000 + i);
    await vaciarPromesas();
    expect(registrarAuditoria).not.toHaveBeenCalled();
  });

  it('ignora una IP vacía', () => {
    expect(() => registrarFalloLogin(undefined)).not.toThrow();
  });
});

describe('evaluarUbicacionNueva()', () => {
  const admin = { id: 'u1', email: 'admin@iiap.org', rol: 'admin_sig' };
  const lugares = {
    '1.1.1.1': { country: 'CO', region: 'CHO', city: 'Quibdó' },
    '2.2.2.2': { country: 'CO', region: 'CHO', city: 'Istmina' },
    '3.3.3.3': { country: 'CO', region: 'VAC', city: 'Cali' },
  };

  beforeEach(() => {
    vi.clearAllMocks();
    definirProveedorUbicacion((ip) => lugares[ip] ?? null);
  });

  it('un administrador desde un departamento nuevo genera el evento y el aviso a su correo', async () => {
    query.mockResolvedValueOnce({ rows: [{ ip: '1.1.1.1' }] });

    await evaluarUbicacionNueva(admin, '3.3.3.3');

    expect(registrarAuditoria).toHaveBeenCalledWith(expect.objectContaining({
      accion: 'login_ubicacion_nueva', usuarioId: 'u1', ip: '3.3.3.3',
      descripcion: expect.stringContaining('Cali, Valle del Cauca, CO'),
    }));
    expect(notifyAlertaSeguridad).toHaveBeenCalledWith(expect.objectContaining({ email: 'admin@iiap.org' }));
  });

  it('no alerta si ya inició sesión desde esa IP o desde el mismo departamento', async () => {
    query.mockResolvedValue({ rows: [{ ip: '1.1.1.1' }] });
    await evaluarUbicacionNueva(admin, '1.1.1.1');
    await evaluarUbicacionNueva(admin, '2.2.2.2');
    expect(registrarAuditoria).not.toHaveBeenCalled();
  });

  it('sin historial previo no hay referencia y no alerta', async () => {
    query.mockResolvedValueOnce({ rows: [] });
    await evaluarUbicacionNueva(admin, '3.3.3.3');
    expect(registrarAuditoria).not.toHaveBeenCalled();
  });

  it('no vigila a roles que no son administradores ni consulta la base', async () => {
    await evaluarUbicacionNueva({ ...admin, rol: 'investigador' }, '3.3.3.3');
    expect(query).not.toHaveBeenCalled();
  });

  it('con una IP sin ubicación conocida no alerta', async () => {
    await evaluarUbicacionNueva(admin, '8.8.8.8');
    expect(query).not.toHaveBeenCalled();
  });

  it('un error de base de datos nunca interrumpe el login', async () => {
    query.mockRejectedValueOnce(new Error('BD caída'));
    await expect(evaluarUbicacionNueva(admin, '3.3.3.3')).resolves.toBeUndefined();
  });
});
