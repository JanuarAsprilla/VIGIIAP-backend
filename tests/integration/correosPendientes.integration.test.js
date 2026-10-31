/**
 * Tests de integración — cola de reintentos de correo (Postgres real).
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { query } from '../../src/config/database.js';
import { encolarFallo, procesarPendientes, MAX_INTENTOS } from '../../src/utils/correosPendientes.js';

const ETIMEDOUT = Object.assign(new Error('connect ETIMEDOUT'), { code: 'ETIMEDOUT' });

async function encolar(n) {
  await encolarFallo({ to: `u${n}@iiap.test`, subject: `Asunto ${n}`, html: `<p>cuerpo ${n}</p>`, error: ETIMEDOUT });
}

const volverVencidos = () => query(`UPDATE correos_pendientes SET proximo_intento_en = NOW() - INTERVAL '1 minute'`);
const filas = async () => (await query('SELECT * FROM correos_pendientes ORDER BY id')).rows;

beforeEach(async () => {
  await query('TRUNCATE TABLE correos_pendientes RESTART IDENTITY');
});

describe('cola de correos', () => {
  it('un correo recién encolado espera su primera espera y no se reenvía todavía', async () => {
    await encolar(1);
    const enviados = [];

    const resultado = await procesarPendientes(async (c) => enviados.push(c));

    expect(resultado.enviados).toBe(0);
    expect(enviados).toHaveLength(0);
    expect((await filas())[0]).toMatchObject({ estado: 'pendiente', intentos: 1 });
  });

  it('un reintento exitoso lo marca enviado y borra el cuerpo', async () => {
    await encolar(1);
    await volverVencidos();

    const resultado = await procesarPendientes(async () => ({ messageId: 'ok' }));

    expect(resultado.enviados).toBe(1);
    const [fila] = await filas();
    expect(fila).toMatchObject({ estado: 'enviado', html: null });
    expect(fila.destinatario).toBe('u1@iiap.test');
  });

  it('un fallo temporal lo reprograma con un intento más y una espera mayor', async () => {
    await encolar(1);
    await volverVencidos();

    const resultado = await procesarPendientes(async () => { throw ETIMEDOUT; });

    expect(resultado.reprogramados).toBe(1);
    const [fila] = await filas();
    expect(fila).toMatchObject({ estado: 'pendiente', intentos: 2 });
    expect(new Date(fila.proximo_intento_en).getTime()).toBeGreaterThan(Date.now());
  });

  it('al agotar los intentos pasa a fallido y no conserva el contenido', async () => {
    await encolar(1);
    await query('UPDATE correos_pendientes SET intentos = $1', [MAX_INTENTOS - 1]);
    await volverVencidos();

    const resultado = await procesarPendientes(async () => { throw ETIMEDOUT; });

    expect(resultado.fallidos).toBe(1);
    expect((await filas())[0]).toMatchObject({ estado: 'fallido', html: null, intentos: MAX_INTENTOS });
  });

  it('dos trabajadores simultáneos nunca envían el mismo correo (SKIP LOCKED)', async () => {
    for (let n = 1; n <= 8; n += 1) await encolar(n);
    await volverVencidos();
    const enviados = [];
    const enviar = async ({ to }) => {
      await new Promise((resolver) => setTimeout(resolver, 20));
      enviados.push(to);
    };

    await Promise.all([procesarPendientes(enviar), procesarPendientes(enviar)]);

    expect(enviados).toHaveLength(8);
    expect(new Set(enviados).size).toBe(8);
  });

  it('el arrendamiento evita que otro trabajador tome un correo ya reclamado', async () => {
    await encolar(1);
    await volverVencidos();
    let liberar;
    const bloqueado = new Promise((resolver) => { liberar = resolver; });
    const primero = procesarPendientes(async () => { await bloqueado; });
    await new Promise((resolver) => setTimeout(resolver, 100));

    const segundo = await procesarPendientes(async () => { throw new Error('no debería enviarse otra vez'); });
    liberar();
    await primero;

    expect(segundo).toMatchObject({ enviados: 0, reprogramados: 0, fallidos: 0 });
  });

  it('purga las filas con más de 14 días', async () => {
    await encolar(1);
    await query(`UPDATE correos_pendientes SET creado_en = NOW() - INTERVAL '15 days'`);

    await procesarPendientes(async () => {});

    expect(await filas()).toHaveLength(0);
  });
});
