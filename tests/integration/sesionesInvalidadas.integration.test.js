/**
 * Sesiones cerradas al instante y respuesta de login uniforme, contra PostgreSQL real.
 *
 * Antes, cambiar la contraseña revocaba los refresh tokens pero el token de acceso seguía valiendo hasta vencer (15 min).
 * Y el mensaje de login distinguía una cuenta de Google de una contraseña mal escrita, delatando qué correos existen.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import { cleanDatabase } from './setup.js';
import { query } from '../../src/config/database.js';
import { updatePassword } from '../../src/modules/usuarios/usuarios.service.js';
import { MENSAJE_CREDENCIALES, revokeAllRefreshTokens } from '../../src/modules/auth/auth.service.js';

const { default: app } = await import('../../src/app.js');

const CLAVE = 'Correcta-123!aB';
const NUEVA = 'Otra-Distinta-456!cD';
let contadorIp = 0;
const esperar = (ms) => new Promise((r) => { setTimeout(r, ms); });

async function crearUsuario(email, { conClave = true, oauth = null } = {}) {
  const { rows } = await query(
    `INSERT INTO usuarios (nombre, email, password_hash, rol, activo, email_verified, oauth_provider, oauth_id, perfil_completo, institucion, motivo_acceso)
     VALUES ('Persona', $1, $2, 'investigador', true, true, $3, $4, true, 'Universidad', 'Investigación') RETURNING id`,
    [email, conClave ? await bcrypt.hash(CLAVE, 4) : null, oauth, oauth ? 'sub-123' : null],
  );
  return rows[0].id;
}

const ip = () => `10.88.${Math.floor(++contadorIp / 250)}.${(contadorIp % 250) + 1}`;
const iniciar = (email, password = CLAVE) => request(app).post('/api/v1/auth/login').set('X-Forwarded-For', ip()).send({ email, password });
const yo = (token) => request(app).get('/api/v1/auth/me').set('X-Forwarded-For', ip()).set('Authorization', `Bearer ${token}`);

beforeEach(async () => {
  await cleanDatabase();
  await query('TRUNCATE TABLE sesiones_invalidadas');
});

describe('sesiones cerradas al instante', () => {
  it('un token de acceso deja de valer al cambiar la contraseña, y la sesión nueva sí', async () => {
    const id = await crearUsuario('a@iiap.test');
    const robado = (await iniciar('a@iiap.test')).body.token;
    expect((await yo(robado)).status).toBe(200);

    await esperar(1100); // los JWT tienen resolución de segundos: el corte es estricto para no cerrar la sesión recién nacida
    await updatePassword(id, CLAVE, NUEVA);

    const rechazado = await yo(robado);
    expect(rechazado.status).toBe(401);
    expect(rechazado.body.error).toMatch(/Sesión cerrada/);

    const nueva = await iniciar('a@iiap.test', NUEVA);
    expect(nueva.status).toBe(200);
    expect((await yo(nueva.body.token)).status).toBe(200);
  });

  it('cerrar las sesiones de una cuenta no toca las de otra', async () => {
    const a = await crearUsuario('a@iiap.test');
    await crearUsuario('b@iiap.test');
    const tokenA = (await iniciar('a@iiap.test')).body.token;
    const tokenB = (await iniciar('b@iiap.test')).body.token;

    await esperar(1100);
    await revokeAllRefreshTokens(a);

    expect((await yo(tokenA)).status).toBe(401);
    expect((await yo(tokenB)).status).toBe(200);
  });

  it('el corte queda guardado en la base para sobrevivir a un reinicio y llegar a otras instancias', async () => {
    const id = await crearUsuario('a@iiap.test');
    await revokeAllRefreshTokens(id);
    const { rows } = await query('SELECT invalidar_antes_de FROM sesiones_invalidadas WHERE usuario_id = $1', [id]);
    expect(rows).toHaveLength(1);
    expect(Math.abs(Date.now() - new Date(rows[0].invalidar_antes_de).getTime())).toBeLessThan(5000);
  });

  it('borrar la cuenta limpia su corte', async () => {
    const id = await crearUsuario('a@iiap.test');
    await revokeAllRefreshTokens(id);
    await query('DELETE FROM usuarios WHERE id = $1', [id]);
    const { rows } = await query('SELECT 1 FROM sesiones_invalidadas WHERE usuario_id = $1', [id]);
    expect(rows).toHaveLength(0);
  });
});

describe('respuesta de login uniforme', () => {
  it('cuenta inexistente, contraseña incorrecta y cuenta de Google responden exactamente igual', async () => {
    await crearUsuario('con-clave@iiap.test');
    await crearUsuario('google@iiap.test', { conClave: false, oauth: 'google' });

    const respuestas = await Promise.all([
      iniciar('nadie@iiap.test', 'cualquiera-123'),
      iniciar('con-clave@iiap.test', 'mal-escrita-123'),
      iniciar('google@iiap.test', 'cualquiera-123'),
    ]);

    for (const r of respuestas) {
      expect(r.status).toBe(401);
      expect(r.body.error).toBe(MENSAJE_CREDENCIALES);
    }
  });

  it('el mensaje común orienta a quien se registró con Google o Microsoft', () => {
    expect(MENSAJE_CREDENCIALES).toMatch(/Google o Microsoft/);
  });
});
