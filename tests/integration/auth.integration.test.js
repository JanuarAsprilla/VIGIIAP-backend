/**
 * Tests de integración — módulo de autenticación.
 * Requieren PostgreSQL real (ver tests/integration/setup.js).
 *
 * Ejecutar: npm run test:integration
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { cleanDatabase } from './setup.js';
import { register, login, verifyEmail } from '../../src/modules/auth/auth.service.js';
import { query } from '../../src/config/database.js';

beforeEach(cleanDatabase);

describe('register()', () => {
  it('crea un usuario y devuelve verificationToken', async () => {
    const result = await register({
      nombre: 'Test User',
      email: 'test@iiap.test',
      password: 'Segura123!',
      perfil: 'investigador',
    });
    expect(result.id).toBeDefined();
    expect(result.email).toBe('test@iiap.test');
    expect(result.verificationToken).toHaveLength(64);

    // Verificar que está en BD con email_verified=false
    const { rows } = await query('SELECT email_verified FROM usuarios WHERE id=$1', [result.id]);
    expect(rows[0].email_verified).toBe(false);
  });

  it('lanza 409 si el email ya existe', async () => {
    await register({ nombre: 'A', email: 'dup@iiap.test', password: 'Segura123!', perfil: 'publico' });
    await expect(
      register({ nombre: 'B', email: 'dup@iiap.test', password: 'Segura123!', perfil: 'publico' })
    ).rejects.toMatchObject({ status: 409 });
  });
});

describe('verifyEmail() + login()', () => {
  it('flujo completo: registro → verificar → login exitoso', async () => {
    const user = await register({
      nombre: 'Flujo Completo',
      email: 'flujo@iiap.test',
      password: 'Segura123!',
      perfil: 'publico',
    });

    // Verificar email
    const verified = await verifyEmail(user.verificationToken);
    expect(verified.alreadyVerified).toBe(false);

    // Activar cuenta manualmente (normalmente lo hace el admin)
    await query('UPDATE usuarios SET activo=true WHERE id=$1', [user.id]);

    // Login
    const result = await login('flujo@iiap.test', 'Segura123!', '127.0.0.1', 'vitest');
    expect(result.token).toBeDefined();
    expect(result.user.email).toBe('flujo@iiap.test');
  });

  it('lanza 401 con password incorrecta (y actualiza intentos_fallidos en BD)', async () => {
    const user = await register({
      nombre: 'Bad Pass',
      email: 'badpass@iiap.test',
      password: 'Segura123!',
      perfil: 'publico',
    });
    await verifyEmail(user.verificationToken);
    await query('UPDATE usuarios SET activo=true WHERE id=$1', [user.id]);

    await expect(login('badpass@iiap.test', 'WrongPass1!', '127.0.0.1', 'vitest'))
      .rejects.toMatchObject({ status: 401 });

    const { rows } = await query('SELECT intentos_fallidos FROM usuarios WHERE id=$1', [user.id]);
    expect(rows[0].intentos_fallidos).toBe(1);
  });

  it('bloquea cuenta tras 5 intentos fallidos consecutivos', async () => {
    const user = await register({
      nombre: 'Lockout Test',
      email: 'lockout@iiap.test',
      password: 'Segura123!',
      perfil: 'publico',
    });
    await verifyEmail(user.verificationToken);
    await query('UPDATE usuarios SET activo=true WHERE id=$1', [user.id]);

    for (let i = 0; i < 5; i++) {
      await login('lockout@iiap.test', 'Wrong!', '127.0.0.1', 'vitest').catch(() => {});
    }

    const { rows } = await query('SELECT bloqueado_hasta FROM usuarios WHERE id=$1', [user.id]);
    expect(rows[0].bloqueado_hasta).not.toBeNull();
  });
});
