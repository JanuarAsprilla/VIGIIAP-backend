/**
 * Tests de integración — la reserva del intento 2FA debe ser atómica con Postgres real: una ráfaga en paralelo
 * no puede verificar más de MAX_INTENTOS_2FA códigos antes del bloqueo.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { cleanDatabase } from './setup.js';
import { query } from '../../src/config/database.js';
import {
  reservarIntentoSegundoFactor, limpiarFallosSegundoFactor, MAX_INTENTOS_2FA,
} from '../../src/modules/auth/twoFactorBloqueo.js';

let usuarioId;

beforeEach(async () => {
  await cleanDatabase();
  const { rows } = await query(`
    INSERT INTO usuarios (nombre, email, password_hash, rol, activo, email_verified)
    VALUES ('Admin', 'admin2fa@iiap.test', '$2b$12$dummy', 'admin_sig', true, true) RETURNING id`);
  usuarioId = rows[0].id;
});

const estado = async () => (await query('SELECT intentos_fallidos, bloqueado_hasta FROM usuarios WHERE id = $1', [usuarioId])).rows[0];

describe('reservarIntentoSegundoFactor() contra Postgres', () => {
  it('permite exactamente MAX_INTENTOS_2FA intentos, el último bloquea y el siguiente recibe 429', async () => {
    for (let i = 1; i < MAX_INTENTOS_2FA; i += 1) {
      expect(await reservarIntentoSegundoFactor(usuarioId)).toEqual({ bloqueaAhora: false });
    }
    expect(await reservarIntentoSegundoFactor(usuarioId)).toEqual({ bloqueaAhora: true });
    expect((await estado()).bloqueado_hasta).not.toBeNull();
    await expect(reservarIntentoSegundoFactor(usuarioId)).rejects.toMatchObject({ status: 429, code: 'ACCOUNT_LOCKED' });
  });

  it('una ráfaga de 40 intentos en paralelo solo deja verificar MAX_INTENTOS_2FA', async () => {
    const resultados = await Promise.allSettled(Array.from({ length: 40 }, () => reservarIntentoSegundoFactor(usuarioId)));
    expect(resultados.filter((r) => r.status === 'fulfilled')).toHaveLength(MAX_INTENTOS_2FA);
    expect(resultados.filter((r) => r.status === 'rejected' && r.reason.status === 429)).toHaveLength(40 - MAX_INTENTOS_2FA);
  });

  it('un código correcto limpia contador y bloqueo; una cuenta desactivada recibe 401', async () => {
    await reservarIntentoSegundoFactor(usuarioId);
    await limpiarFallosSegundoFactor(usuarioId);
    expect(await estado()).toMatchObject({ intentos_fallidos: 0, bloqueado_hasta: null });
    await query('UPDATE usuarios SET activo = false WHERE id = $1', [usuarioId]);
    await expect(reservarIntentoSegundoFactor(usuarioId)).rejects.toMatchObject({ status: 401 });
  });
});
