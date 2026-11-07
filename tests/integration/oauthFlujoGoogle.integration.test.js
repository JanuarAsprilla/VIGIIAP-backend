/**
 * Flujo completo de Google (/start → Google → /callback → sesión) contra PostgreSQL real, con Google simulado y aplicando la
 * regla de cookies del navegador (RFC 6265): una cookie solo viaja si su path es prefijo de la ruta pedida.
 *
 * Regresión de 2026-11-06: las cookies de protección del flujo salían con path=/api/auth/oauth y el retorno es
 * /api/v1/auth/oauth/<proveedor>/callback, así que el servidor no las recibía y NADIE lograba entrar con Google.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import { cleanDatabase } from './setup.js';
import { query } from '../../src/config/database.js';

process.env.GOOGLE_CLIENT_ID = 'cid';
process.env.GOOGLE_CLIENT_SECRET = 'csecret';
process.env.BACKEND_PUBLIC_URL = 'https://vigiiap.iiap.org.co';
process.env.FRONTEND_URL = 'https://vigiiap.iiap.org.co';
const { default: app } = await import('../../src/app.js');

const realFetch = globalThis.fetch;
let perfilGoogle;

beforeEach(async () => {
  await cleanDatabase();
  vi.stubGlobal('fetch', vi.fn(async (url, opts) => {
    const u = String(url);
    if (u === 'https://oauth2.googleapis.com/token') return new Response(JSON.stringify({ access_token: 'at' }), { status: 200 });
    if (u.startsWith('https://www.googleapis.com/oauth2/v3/userinfo')) return new Response(JSON.stringify(perfilGoogle), { status: 200 });
    return realFetch(url, opts);
  }));
});
afterEach(() => vi.unstubAllGlobals());

const viaja = (path, ruta) => ruta === path || (ruta.startsWith(path) && (path.endsWith('/') || ruta[path.length] === '/'));

function cookiesEmitidas(res) {
  return (res.headers['set-cookie'] ?? []).map((c) => {
    const p = c.split(';').map((x) => x.trim());
    return { nombre: p[0].split('=')[0], valor: p[0].slice(p[0].indexOf('=') + 1), path: p.find((x) => /^path=/i.test(x))?.slice(5) ?? '/' };
  });
}
const cabecera = (cookies, ruta) => cookies.filter((c) => viaja(c.path, ruta)).map((c) => `${c.nombre}=${c.valor}`).join('; ');

/** Recorre el flujo como lo haría el navegador y devuelve a dónde termina y con qué cookies. */
async function entrarConGoogle(perfil) {
  perfilGoogle = perfil;
  const inicio = await request(app).get('/api/v1/auth/oauth/google/start');
  expect(inicio.status).toBe(302);
  const state = new URL(inicio.headers.location).searchParams.get('state');
  const rutaCallback = '/api/v1/auth/oauth/google/callback';
  const cb = await request(app)
    .get(`${rutaCallback}?code=abc&state=${encodeURIComponent(state)}`)
    .set('Cookie', cabecera(cookiesEmitidas(inicio), rutaCallback));
  return { destino: new URL(cb.headers.location), cookies: cookiesEmitidas(cb) };
}

const sesion = async (cookies) => (await request(app).get('/api/v1/auth/me').set('Cookie', cabecera(cookies, '/api/v1/auth/me'))).status;
const google = (email, sub) => ({ sub, email, email_verified: true, name: 'Persona', picture: null });

async function crear(email, { clave = false, oauth = null, verificado = true, activo = true, totp = false, perfilCompleto = true } = {}) {
  const { rows } = await query(
    `INSERT INTO usuarios (nombre, email, password_hash, rol, activo, email_verified, oauth_provider, oauth_id, perfil_completo, totp_enabled, totp_secret)
     VALUES ('Existente', $1, $2, 'investigador', $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
    [email, clave ? await bcrypt.hash('Clave-123!aBc', 4) : null, activo, verificado, oauth?.provider ?? null, oauth?.id ?? null, perfilCompleto, totp, totp ? 'JBSWY3DPEHPK3PXP' : null],
  );
  return rows[0].id;
}

describe('el inicio de sesión con Google funciona de punta a punta', () => {
  it('un usuario que ya entraba con Google (cuenta creada por Google) vuelve a entrar', async () => {
    await crear('g@gmail.test', { oauth: { provider: 'google', id: 'g-1' } });
    const { destino, cookies } = await entrarConGoogle(google('g@gmail.test', 'g-1'));

    expect(destino.searchParams.get('oauthError')).toBeNull();
    expect(await sesion(cookies)).toBe(200);
  });

  it('una cuenta de Google con el perfil incompleto entra y se le pide completarlo', async () => {
    await crear('p@gmail.test', { oauth: { provider: 'google', id: 'g-2' }, perfilCompleto: false });
    const { destino, cookies } = await entrarConGoogle(google('p@gmail.test', 'g-2'));

    expect(destino.searchParams.get('completarPerfil')).toBe('1');
    expect(await sesion(cookies)).toBe(200);
  });

  it('una cuenta existente CON CONTRASEÑA y el mismo correo vincula Google y entra, sin tocar la contraseña', async () => {
    const id = await crear('ana@gmail.test', { clave: true });
    const { destino, cookies } = await entrarConGoogle(google('ana@gmail.test', 'g-3'));

    expect(destino.searchParams.get('oauthError')).toBeNull();
    expect(await sesion(cookies)).toBe(200);
    const { rows: [u] } = await query('SELECT oauth_provider, oauth_id, password_hash FROM usuarios WHERE id = $1', [id]);
    expect(u).toMatchObject({ oauth_provider: 'google', oauth_id: 'g-3' });
    expect(u.password_hash).toMatch(/^\$2/); // la contraseña sigue intacta
    const { rows: auditoria } = await query(`SELECT accion FROM audit_log WHERE accion = 'oauth_vinculo_cuenta'`);
    expect(auditoria).toHaveLength(1);
  });

  it('con 2FA activo, vincular Google NO evita el segundo factor: no hay sesión hasta confirmar el código', async () => {
    await crear('tf@gmail.test', { clave: true, totp: true });
    const { destino, cookies } = await entrarConGoogle(google('tf@gmail.test', 'g-4'));

    expect(destino.pathname).toBe('/login');
    expect(destino.searchParams.get('requiresTwoFactor')).toBe('1');
    expect(cookies.map((c) => c.nombre)).not.toContain('vigiiap_token');
    expect(cookies.find((c) => c.nombre === 'vigiiap_2fa_temp')?.path).toBe('/api');
  });

  it('una cuenta con contraseña ya vinculada a OTRA identidad de Google no se re-vincula', async () => {
    await crear('v@gmail.test', { clave: true, oauth: { provider: 'google', id: 'identidad-real' } });
    const { destino, cookies } = await entrarConGoogle(google('v@gmail.test', 'identidad-del-atacante'));

    expect(destino.searchParams.get('oauthError')).toBe('EMAIL_LINKED_TO_OTHER_IDENTITY');
    expect(await sesion(cookies)).toBe(401);
  });

  it('un correo sin cuenta crea una cuenta nueva pendiente de verificar y NO abre sesión', async () => {
    const { destino, cookies } = await entrarConGoogle(google('nuevo@gmail.test', 'g-5'));

    expect(destino.searchParams.get('oauthError')).toBe('EMAIL_VERIFICATION_SENT');
    expect(await sesion(cookies)).toBe(401);
  });

  it('una cuenta inactiva (pendiente de aprobación) no entra, aunque vincule', async () => {
    await crear('ina@gmail.test', { clave: true, activo: false });
    const { destino, cookies } = await entrarConGoogle(google('ina@gmail.test', 'g-6'));

    expect(destino.searchParams.get('oauthError')).toBe('ACCOUNT_INACTIVE');
    expect(await sesion(cookies)).toBe(401);
  });

  it('una cuenta con contraseña y correo SIN verificar no se vincula (se trata como reclamo previo)', async () => {
    await crear('sin@gmail.test', { clave: true, verificado: false });
    const { destino } = await entrarConGoogle(google('sin@gmail.test', 'g-7'));

    expect(destino.searchParams.get('oauthError')).toBe('EMAIL_VERIFICATION_PENDING');
  });
});
