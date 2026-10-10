/**
 * Tests de integración — módulo de autenticación.
 * Requieren PostgreSQL real (ver tests/integration/setup.js).
 *
 * Ejecutar: npm run test:integration
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { cleanDatabase } from './setup.js';
import { register, login, verifyEmail, reenviarVerificacion } from '../../src/modules/auth/auth.service.js';
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

  it('lanza 409 si el email ya existe y YA ESTÁ VERIFICADO', async () => {
    const primero = await register({ nombre: 'A', email: 'dup@iiap.test', password: 'Segura123!', perfil: 'publico' });
    await verifyEmail(primero.verificationToken);
    await expect(
      register({ nombre: 'B', email: 'dup@iiap.test', password: 'Segura123!', perfil: 'publico' })
    ).rejects.toMatchObject({ status: 409 });
  });

  // REGRESIÓN (account takeover / carrera de reclamo): mientras el enlace del
  // PRIMER intento sigue vigente (24h), un segundo intento con el mismo
  // correo debe bloquearse — reclamarlo de inmediato dejaría que cualquiera
  // que solo conozca el correo de alguien registrándose en este momento le
  // "robe" la cuenta ganándole la carrera a su propio enlace.
  it('un registro previo SIN verificar, con el enlace TODAVÍA vigente, bloquea un segundo intento en vez de reescribirlo', async () => {
    await register({ nombre: 'Dueña Real', email: 'buena-fe@iiap.test', password: 'MiPropiaContraseña1!', perfil: 'publico' });

    await expect(
      register({ nombre: 'Atacante', email: 'buena-fe@iiap.test', password: 'ContraseñaDelAtacante1!', perfil: 'publico' })
    ).rejects.toMatchObject({ status: 409, code: 'EMAIL_VERIFICATION_PENDING' });
  });

  // REGRESIÓN (pre-hijacking / backdoor de verificación): si alguien "reserva"
  // un correo con el registro pero nunca lo verifica Y ya pasaron 24h desde
  // que se creó, no debe poder negarle esa cuenta para siempre a su dueño
  // real — la fila se reclama (reescribe), no se bloquea con 409.
  it('un registro previo SIN verificar, creado hace más de 24h, se puede reclamar con una contraseña nueva', async () => {
    const primero = await register({ nombre: 'Atacante', email: 'squat@iiap.test', password: 'ContraseñaDelAtacante1!', perfil: 'publico' });
    // Simula el paso de las 24h desde la creación, sin que nadie lo haya confirmado.
    await query('UPDATE usuarios SET creado_en = NOW() - INTERVAL \'25 hours\' WHERE id=$1', [primero.id]);

    const segundo = await register({ nombre: 'Dueña Real', email: 'squat@iiap.test', password: 'MiPropiaContraseña1!', perfil: 'publico' });
    expect(segundo.id).toBe(primero.id); // misma fila, reescrita — no un duplicado
    expect(segundo.verificationToken).not.toBe(primero.verificationToken);

    // El token del primer intento (el del atacante) ya no sirve.
    await expect(verifyEmail(primero.verificationToken)).rejects.toMatchObject({ status: 400 });

    // El token del segundo intento sí verifica, y la contraseña vigente es la del segundo intento.
    await verifyEmail(segundo.verificationToken);
    await query('UPDATE usuarios SET activo=true WHERE id=$1', [segundo.id]);
    await expect(login('squat@iiap.test', 'ContraseñaDelAtacante1!', '127.0.0.1', 'vitest'))
      .rejects.toMatchObject({ status: 401 }); // la contraseña del atacante ya no abre la cuenta
    const result = await login('squat@iiap.test', 'MiPropiaContraseña1!', '127.0.0.1', 'vitest');
    expect(result.user.email).toBe('squat@iiap.test');
  });

  // REGRESIÓN (account takeover, hallazgo real de la revisión automática
  // sobre el intento anterior de este mismo fix): el reclamo de arriba DEBE
  // resetear creado_en a NOW() -- si no lo hiciera, la fila recién reclamada
  // seguiría pareciendo "creada hace >24h" para siempre, y cualquiera (p.ej.
  // el mismo atacante original) podría volver a reclamarla de inmediato,
  // reescribiendo la contraseña que la dueña real acaba de establecer.
  it('justo después de un reclamo legítimo, un segundo intento NO puede reclamarla de nuevo de inmediato', async () => {
    const primero = await register({ nombre: 'Atacante', email: 'squat-doble@iiap.test', password: 'ContraseñaDelAtacante1!', perfil: 'publico' });
    await query('UPDATE usuarios SET creado_en = NOW() - INTERVAL \'25 hours\' WHERE id=$1', [primero.id]);

    const segundo = await register({ nombre: 'Dueña Real', email: 'squat-doble@iiap.test', password: 'MiPropiaContraseña1!', perfil: 'publico' });
    expect(segundo.id).toBe(primero.id);

    // El atacante vuelve a intentar de inmediato, sin que pase tiempo real.
    await expect(
      register({ nombre: 'Atacante Otra Vez', email: 'squat-doble@iiap.test', password: 'OtraContraseñaDelAtacante1!', perfil: 'publico' })
    ).rejects.toMatchObject({ status: 409, code: 'EMAIL_VERIFICATION_PENDING' });

    // La contraseña vigente sigue siendo la del reclamo legítimo.
    await verifyEmail(segundo.verificationToken);
    await query('UPDATE usuarios SET activo=true WHERE id=$1', [segundo.id]);
    const result = await login('squat-doble@iiap.test', 'MiPropiaContraseña1!', '127.0.0.1', 'vitest');
    expect(result.user.email).toBe('squat-doble@iiap.test');
  });

  // REGRESIÓN (DoS permanente vía resend, hallazgo de la revisión automática
  // sobre el intento anterior de este fix): reenviarVerificacion() es
  // pública y sin autenticar — reenvía un token nuevo con una expiración
  // nueva cada vez. Si el reclamo de arriba dependiera de esa expiración (en
  // vez de creado_en, que nadie puede tocar), un atacante podría llamar a
  // reenviarVerificacion sobre su propio squat cada tanto y mantenerlo
  // "vigente" para siempre, recreando el DoS permanente. Aquí se simula
  // exactamente eso -- reenviar varias veces no debe impedir el reclamo una
  // vez que de verdad pasaron 24h desde la creación real.
  it('reenviar la verificación repetidamente NO extiende la ventana de reclamo — solo importa cuándo se creó la fila', async () => {
    const primero = await register({ nombre: 'Atacante', email: 'squat-resend@iiap.test', password: 'ContraseñaDelAtacante1!', perfil: 'publico' });

    // El atacante reenvía su propia verificación varias veces -- cada
    // llamada renueva email_verification_expires, pero NO creado_en.
    await reenviarVerificacion('squat-resend@iiap.test');
    await reenviarVerificacion('squat-resend@iiap.test');

    const { rows: antes } = await query('SELECT email_verification_expires FROM usuarios WHERE id=$1', [primero.id]);
    expect(new Date(antes[0].email_verification_expires) > new Date(Date.now() + 23 * 60 * 60 * 1000)).toBe(true); // "vigente" según ese campo

    // Pero ya pasaron 24h reales desde que la fila se CREÓ.
    await query('UPDATE usuarios SET creado_en = NOW() - INTERVAL \'25 hours\' WHERE id=$1', [primero.id]);

    const segundo = await register({ nombre: 'Dueña Real', email: 'squat-resend@iiap.test', password: 'MiPropiaContraseña1!', perfil: 'publico' });
    expect(segundo.id).toBe(primero.id); // se reclama igual — los resends del atacante no lo protegieron
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
