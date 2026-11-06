/**
 * Regresiones de producción (2026-11-05), contra PostgreSQL real:
 *  1. Asignar 'biodiversidad_datos' o 'custodia' a un administrador fallaba con «violates check constraint
 *     admin_permisos_modulo_modulo_check» porque el CHECK de la BD no incluía los dos módulos del catálogo del código.
 *  2. Las cookies temporales de 2FA y de contraseña vencida se emitían con path '/api/auth/...' y el frontend llama a
 *     '/api/v1/auth/...': el navegador no las devolvía y esos pasos del login no se podían completar.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import * as OTPAuth from 'otpauth';
import { cleanDatabase } from './setup.js';
import { query } from '../../src/config/database.js';
import app from '../../src/app.js';
import { MODULOS } from '../../src/modules/admin/modulos.service.js';

const CLAVE = 'Correcta-123!aB';
const CLAVE_NUEVA = 'Nueva-Clave-456!aB';
const SECRETO_TOTP = 'JBSWY3DPEHPK3PXP';

/** Regla de RFC 6265 §5.1.4: ¿devuelve el navegador una cookie con este path a esta ruta? */
function navegadorEnviaCookie(rutaCookie, rutaPeticion) {
  if (rutaPeticion === rutaCookie) return true;
  if (!rutaPeticion.startsWith(rutaCookie)) return false;
  return rutaCookie.endsWith('/') || rutaPeticion[rutaCookie.length] === '/';
}

function cookieEmitida(respuesta, nombre) {
  const linea = (respuesta.headers['set-cookie'] ?? []).find((c) => c.startsWith(`${nombre}=`));
  if (!linea) return null;
  const partes = linea.split(';').map((p) => p.trim());
  return { nombre, valor: partes[0].slice(nombre.length + 1), path: partes.find((p) => /^path=/i.test(p))?.slice(5) };
}

/** Lo que enviaría el navegador a `ruta`: la cookie solo viaja si su path coincide. */
const cabeceraCookie = (cookie, ruta) => (navegadorEnviaCookie(cookie.path, ruta) ? `${cookie.nombre}=${cookie.valor}` : '');

async function crearUsuario(email, rol = 'investigador') {
  const { rows } = await query(
    `INSERT INTO usuarios (nombre, email, password_hash, rol, activo, email_verified)
     VALUES ('Antiguo', $1, $2, $3, true, true) RETURNING id`,
    [email, await bcrypt.hash(CLAVE, 4), rol],
  );
  return rows[0].id;
}

beforeEach(() => cleanDatabase());

describe('la regla del navegador que usan estas pruebas', () => {
  it('la ruta antigua NO se enviaba a /api/v1; la nueva sí, y también a /api', () => {
    expect(navegadorEnviaCookie('/api/auth/2fa/confirm', '/api/v1/auth/2fa/confirm')).toBe(false);
    expect(navegadorEnviaCookie('/api', '/api/v1/auth/2fa/confirm')).toBe(true);
    expect(navegadorEnviaCookie('/api', '/api/auth/2fa/confirm')).toBe(true);
    expect(navegadorEnviaCookie('/api', '/apix/otra')).toBe(false);
  });
});

describe('catálogo de módulos delegables', () => {
  it('todos los módulos del catálogo del código se pueden asignar a un administrador', async () => {
    const id = await crearUsuario('admin@iiap.test', 'admin_sig');
    const fallos = [];
    for (const { clave } of MODULOS) {
      try {
        await query('INSERT INTO admin_permisos_modulo (usuario_id, modulo, puede_ver, puede_editar) VALUES ($1, $2, true, false)', [id, clave]);
      } catch (e) {
        fallos.push(`${clave}: ${e.constraint ?? e.message}`);
      }
    }
    expect(fallos).toEqual([]);
  });

  it('un módulo que no existe en el catálogo sigue rechazándose', async () => {
    const id = await crearUsuario('admin@iiap.test', 'admin_sig');
    await expect(query('INSERT INTO admin_permisos_modulo (usuario_id, modulo, puede_ver) VALUES ($1, $2, true)', [id, 'inventado']))
      .rejects.toMatchObject({ constraint: 'admin_permisos_modulo_modulo_check' });
  });
});

describe('contraseña vencida: el paso intermedio del login se puede completar desde /api/v1', () => {
  it('login → cookie temporal → cambio de contraseña → nuevo login', async () => {
    const id = await crearUsuario('ven@iiap.test');
    await query(`INSERT INTO configuracion (clave, valor) VALUES ('passwordExpiryDays', '90') ON CONFLICT (clave) DO UPDATE SET valor = '90'`);
    await query(`UPDATE usuarios SET password_changed_at = NOW() - INTERVAL '200 days' WHERE id = $1`, [id]);

    const login = await request(app).post('/api/v1/auth/login').send({ email: 'ven@iiap.test', password: CLAVE });
    expect(login.status).toBe(403);
    expect(login.body).toMatchObject({ code: 'PASSWORD_EXPIRED' });

    const cookie = cookieEmitida(login, 'vigiiap_expired_temp');
    const ruta = '/api/v1/auth/change-expired-password';
    const cabecera = cabeceraCookie(cookie, ruta);
    expect(cabecera, 'el navegador debe devolver la cookie a la ruta que llama el frontend').not.toBe('');

    const cambio = await request(app).post(ruta).set('Cookie', cabecera).send({ password: CLAVE_NUEVA });
    expect(cambio.status).toBe(200);

    const relogin = await request(app).post('/api/v1/auth/login').send({ email: 'ven@iiap.test', password: CLAVE_NUEVA });
    expect(relogin.status).toBe(200);
  });
});

describe('segundo factor: el paso intermedio del login se puede completar desde /api/v1', () => {
  it('login → cookie temporal → código TOTP → sesión', async () => {
    const id = await crearUsuario('tf@iiap.test');
    await query(`UPDATE usuarios SET totp_enabled = true, totp_secret = $2 WHERE id = $1`, [id, SECRETO_TOTP]);

    const login = await request(app).post('/api/v1/auth/login').send({ email: 'tf@iiap.test', password: CLAVE });
    expect(login.status).toBe(200);

    const cookie = cookieEmitida(login, 'vigiiap_2fa_temp');
    const ruta = '/api/v1/auth/2fa/confirm';
    const cabecera = cabeceraCookie(cookie, ruta);
    expect(cabecera, 'el navegador debe devolver la cookie a la ruta que llama el frontend').not.toBe('');

    const code = new OTPAuth.TOTP({ secret: OTPAuth.Secret.fromBase32(SECRETO_TOTP), period: 30 }).generate();
    const confirmacion = await request(app).post(ruta).set('Cookie', cabecera).send({ code });

    expect(confirmacion.status).toBe(200);
    expect(cookieEmitida(confirmacion, 'vigiiap_token')).not.toBeNull();
  });
});
