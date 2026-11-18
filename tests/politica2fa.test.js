import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../src/config/database.js', () => ({ query: vi.fn() }));
vi.mock('../src/config/dynamicConfig.js', () => ({ getRequire2faAdmins: vi.fn() }));

import { query } from '../src/config/database.js';
import { getRequire2faAdmins } from '../src/config/dynamicConfig.js';
import { incumplePolitica2fa, olvidarEstado2fa, esRutaExenta2fa } from '../src/utils/politica2fa.js';

const ADMIN = (id) => ({ id, rol: 'admin_sig' });

describe('incumplePolitica2fa()', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getRequire2faAdmins.mockResolvedValue(true);
  });

  it('con la política apagada no consulta la base de datos ni bloquea a nadie', async () => {
    getRequire2faAdmins.mockResolvedValue(false);

    expect(await incumplePolitica2fa(ADMIN('a1'))).toBe(false);
    expect(query).not.toHaveBeenCalled();
  });

  it('los roles que no son administrativos nunca incumplen y no consultan nada', async () => {
    for (const rol of ['investigador', 'tecnico', 'institucional', 'publico', 'visitante']) {
      expect(await incumplePolitica2fa({ id: 'u', rol })).toBe(false);
    }
    expect(getRequire2faAdmins).not.toHaveBeenCalled();
    expect(query).not.toHaveBeenCalled();
  });

  it('un administrador sin TOTP incumple; con TOTP cumple', async () => {
    query.mockResolvedValueOnce({ rows: [{ totp_enabled: false }] });
    expect(await incumplePolitica2fa(ADMIN('sin-totp'))).toBe(true);

    query.mockResolvedValueOnce({ rows: [{ totp_enabled: true }] });
    expect(await incumplePolitica2fa({ id: 'con-totp', rol: 'super_admin' })).toBe(false);
  });

  it('cachea el estado un rato y olvidarEstado2fa lo refresca (tras activar 2FA no hay que esperar)', async () => {
    query.mockResolvedValueOnce({ rows: [{ totp_enabled: false }] });
    expect(await incumplePolitica2fa(ADMIN('cache-1'))).toBe(true);
    expect(await incumplePolitica2fa(ADMIN('cache-1'))).toBe(true);
    expect(query).toHaveBeenCalledOnce();

    olvidarEstado2fa('cache-1');
    query.mockResolvedValueOnce({ rows: [{ totp_enabled: true }] });
    expect(await incumplePolitica2fa(ADMIN('cache-1'))).toBe(false);
    expect(query).toHaveBeenCalledTimes(2);
  });

  it('una cuenta que ya no existe cuenta como sin 2FA', async () => {
    query.mockResolvedValueOnce({ rows: [] });
    expect(await incumplePolitica2fa(ADMIN('borrada'))).toBe(true);
  });
});

describe('esRutaExenta2fa()', () => {
  const exenta = (originalUrl) => esRutaExenta2fa({ originalUrl });

  it.each([
    '/api/auth/me', '/api/v1/auth/me', '/api/auth/csrf-token', '/api/auth/2fa/setup', '/api/auth/2fa/verify',
    '/api/auth/logout', '/api/auth/sessions', '/api/usuarios/me', '/api/usuarios/me/password',
    '/api/notificaciones/prefs', '/api/auth/me?x=1',
  ])('permite %s', (ruta) => {
    expect(exenta(ruta)).toBe(true);
  });

  it.each([
    '/api/admin/stats', '/api/admin/configuracion', '/api/usuarios', '/api/usuarios/otro-id',
    '/api/solicitudes', '/api/geovisores', '/api/authx/me', '/api/notificaciones',
    '/api/admin/auth/me',
  ])('no exime %s', (ruta) => {
    expect(exenta(ruta)).toBe(false);
  });
});
