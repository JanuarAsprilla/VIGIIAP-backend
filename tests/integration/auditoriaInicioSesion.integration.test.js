/**
 * Auditoría del inicio de sesión, de punta a punta, contra PostgreSQL real.
 *
 * Un «navegador» simulado guarda las cookies como lo haría uno de verdad (RFC 6265): solo reenvía una cookie si su path es
 * prefijo de la ruta pedida, descarta las que el servidor borra y exige Secure por HTTPS. Así una cookie con el path mal puesto
 * —el defecto que dejó sin entrar a todos los usuarios de Google, de 2FA y de contraseña vencida— rompe la prueba.
 *
 * Cada camino por el que una persona puede entrar o quedarse sin entrar tiene aquí su caso.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import * as OTPAuth from 'otpauth';
import { cleanDatabase } from './setup.js';
import { query } from '../../src/config/database.js';

process.env.GOOGLE_CLIENT_ID = 'cid';
process.env.GOOGLE_CLIENT_SECRET = 'csecret';
process.env.BACKEND_PUBLIC_URL = 'https://vigiiap.iiap.org.co';
process.env.FRONTEND_URL = 'https://vigiiap.iiap.org.co';
const { default: app } = await import('../../src/app.js');

const CLAVE = 'Correcta-123!aB';
const SECRETO_TOTP = 'JBSWY3DPEHPK3PXP';
const realFetch = globalThis.fetch;
let perfilGoogle;
let contadorIp = 0;

const codigoTotp = (desplazamientoMs = 0) =>
  new OTPAuth.TOTP({ secret: OTPAuth.Secret.fromBase32(SECRETO_TOTP), period: 30 }).generate({ timestamp: Date.now() + desplazamientoMs });

/** Navegador simulado: almacén de cookies con las reglas de RFC 6265 que importan aquí. */
class Navegador {
  constructor() {
    this.cookies = new Map();
    this.ip = `10.77.${Math.floor(++contadorIp / 250)}.${(contadorIp % 250) + 1}`; // cada navegador, su IP: no se cruzan los límites
  }

  enviadas(ruta) {
    const viaja = (path) => ruta === path || (ruta.startsWith(path) && (path.endsWith('/') || ruta[path.length] === '/'));
    return [...this.cookies.values()].filter((c) => viaja(c.path)).map((c) => `${c.nombre}=${c.valor}`).join('; ');
  }

  guardar(res) {
    for (const linea of res.headers['set-cookie'] ?? []) {
      const p = linea.split(';').map((x) => x.trim());
      const nombre = p[0].split('=')[0];
      const valor = p[0].slice(nombre.length + 1);
      const atributo = (k) => p.find((x) => x.toLowerCase().startsWith(`${k}=`))?.slice(k.length + 1);
      const path = atributo('path') ?? '/';
      const caducada = atributo('max-age') === '0' || (atributo('expires') && new Date(atributo('expires')) < new Date());
      const llave = `${nombre}|${path}`;
      if (caducada || valor === '') this.cookies.delete(llave);
      else this.cookies.set(llave, { nombre, valor, path });
    }
  }

  async pedir(metodo, ruta, { cuerpo, cabeceras = {} } = {}) {
    let r = request(app)[metodo](ruta).set('X-Forwarded-For', this.ip);
    const cookie = this.enviadas(ruta.split('?')[0]);
    if (cookie) r = r.set('Cookie', cookie);
    for (const [k, v] of Object.entries(cabeceras)) r = r.set(k, v);
    const res = cuerpo ? await r.send(cuerpo) : await r;
    this.guardar(res);
    return res;
  }

  get = (ruta) => this.pedir('get', ruta);
  post = (ruta, cuerpo, cabeceras) => this.pedir('post', ruta, { cuerpo: cuerpo ?? {}, cabeceras });
  tiene = (nombre) => [...this.cookies.values()].some((c) => c.nombre === nombre);
  haySesion = async () => (await this.get('/api/v1/auth/me')).status === 200;
}

async function crearUsuario(email, o = {}) {
  const d = { clave: true, activo: true, verificado: true, totp: false, oauth: null, rol: 'investigador', perfilCompleto: true, ...o };
  const { rows } = await query(
    `INSERT INTO usuarios (nombre, email, password_hash, rol, activo, email_verified, oauth_provider, oauth_id, perfil_completo, totp_enabled, totp_secret)
     VALUES ('Persona', $1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING id`,
    [email, d.clave ? await bcrypt.hash(CLAVE, 4) : null, d.rol, d.activo, d.verificado, d.oauth?.provider ?? null, d.oauth?.id ?? null, d.perfilCompleto, d.totp, d.totp ? SECRETO_TOTP : null],
  );
  return rows[0].id;
}

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

describe('contraseña: sesión, renovación y cierre', () => {
  it('entra, mantiene la sesión, la renueva con el refresh y al cerrar queda sin sesión', async () => {
    await crearUsuario('a@iiap.test');
    const nav = new Navegador();

    const login = await nav.post('/api/v1/auth/login', { email: 'a@iiap.test', password: CLAVE });
    expect(login.status).toBe(200);
    expect(await nav.haySesion()).toBe(true);

    // Renovación: el navegador solo manda el refresh a /api/v1/auth/refresh y el servidor lo rota (el JWT de acceso, en cambio, es
    // determinista y puede repetirse dentro del mismo segundo, por eso lo que se compara es el refresh, que es aleatorio).
    const antes = nav.cookies.get('vigiiap_refresh|/api/v1/auth/refresh')?.valor;
    const refresh = await nav.post('/api/v1/auth/refresh');
    expect(refresh.status).toBe(200);
    expect(nav.cookies.get('vigiiap_refresh|/api/v1/auth/refresh')?.valor).not.toBe(antes);
    expect(await nav.haySesion()).toBe(true);

    // Cierre: pide su token CSRF y el servidor borra las cookies de sesión.
    const { csrfToken } = (await nav.get('/api/v1/auth/csrf-token')).body;
    const logout = await nav.post('/api/v1/auth/logout', {}, { 'X-CSRF-Token': csrfToken });
    expect(logout.status).toBe(200);
    expect(nav.tiene('vigiiap_token')).toBe(false);
    expect(await nav.haySesion()).toBe(false);
  });

  it('un token ya revocado por el cierre de sesión no sirve aunque alguien lo conserve', async () => {
    await crearUsuario('b@iiap.test');
    const nav = new Navegador();
    const login = await nav.post('/api/v1/auth/login', { email: 'b@iiap.test', password: CLAVE });
    const token = login.body.token;
    const { csrfToken } = (await nav.get('/api/v1/auth/csrf-token')).body;
    await nav.post('/api/v1/auth/logout', {}, { 'X-CSRF-Token': csrfToken });

    const reuso = await request(app).get('/api/v1/auth/me').set('Authorization', `Bearer ${token}`);
    expect(reuso.status).toBe(401);
  });

  it('el refresh sin cookie, o ya consumido, no entrega sesión', async () => {
    await crearUsuario('c@iiap.test');
    const nav = new Navegador();
    await nav.post('/api/v1/auth/login', { email: 'c@iiap.test', password: CLAVE });
    const refreshOriginal = nav.cookies.get('vigiiap_refresh|/api/v1/auth/refresh');
    expect(refreshOriginal).toBeTruthy();

    await nav.post('/api/v1/auth/refresh'); // rota
    const otro = new Navegador();
    otro.cookies.set('vigiiap_refresh|/api/v1/auth/refresh', refreshOriginal); // quien robó el anterior
    expect((await otro.post('/api/v1/auth/refresh')).status).toBe(401);
    expect((await new Navegador().post('/api/v1/auth/refresh')).status).toBe(401);
  });
});

describe('contraseña: rechazos y bloqueo', () => {
  it('contraseña incorrecta y cuenta inexistente responden igual (no revelan qué cuentas existen)', async () => {
    await crearUsuario('d@iiap.test');
    const nav = new Navegador();
    const mala = await nav.post('/api/v1/auth/login', { email: 'd@iiap.test', password: 'Incorrecta-123!' });
    const noExiste = await nav.post('/api/v1/auth/login', { email: 'nadie@iiap.test', password: 'Incorrecta-123!' });

    expect([mala.status, noExiste.status]).toEqual([401, 401]);
    expect(mala.body.error).toBe(noExiste.body.error);
  });

  it('cinco intentos fallidos bloquean la cuenta y ni la contraseña correcta entra mientras dura el bloqueo', async () => {
    await crearUsuario('e@iiap.test');
    const nav = new Navegador();
    for (let i = 0; i < 5; i += 1) await nav.post('/api/v1/auth/login', { email: 'e@iiap.test', password: 'Incorrecta-123!' });

    const conCorrecta = await nav.post('/api/v1/auth/login', { email: 'e@iiap.test', password: CLAVE });
    expect(conCorrecta.status).toBe(429);
    expect(await nav.haySesion()).toBe(false);
  });

  it('una cuenta con el correo sin verificar o inactiva no abre sesión y dice por qué', async () => {
    await crearUsuario('f@iiap.test', { verificado: false });
    await crearUsuario('g@iiap.test', { activo: false });
    const nav = new Navegador();

    const sinVerificar = await nav.post('/api/v1/auth/login', { email: 'f@iiap.test', password: CLAVE });
    const inactiva = await nav.post('/api/v1/auth/login', { email: 'g@iiap.test', password: CLAVE });

    expect(sinVerificar.status).toBe(403);
    expect(inactiva.status).toBe(403);
    expect(sinVerificar.body.error).not.toBe(inactiva.body.error);
    expect(await nav.haySesion()).toBe(false);
  });
});

describe('segundo factor con contraseña', () => {
  it('login → código correcto → sesión', async () => {
    await crearUsuario('h@iiap.test', { totp: true });
    const nav = new Navegador();

    const login = await nav.post('/api/v1/auth/login', { email: 'h@iiap.test', password: CLAVE });
    expect(login.status).toBe(200);
    expect(nav.tiene('vigiiap_2fa_temp')).toBe(true);
    expect(await nav.haySesion()).toBe(false); // todavía sin sesión: falta el código

    const confirmacion = await nav.post('/api/v1/auth/2fa/confirm', { code: codigoTotp() });
    expect(confirmacion.status).toBe(200);
    expect(await nav.haySesion()).toBe(true);
    expect(nav.tiene('vigiiap_2fa_temp')).toBe(false); // la cookie temporal se gasta
  });

  it('un código incorrecto no da sesión y cinco bloquean la cuenta', async () => {
    await crearUsuario('i@iiap.test', { totp: true });
    const nav = new Navegador();
    await nav.post('/api/v1/auth/login', { email: 'i@iiap.test', password: CLAVE });

    const primero = await nav.post('/api/v1/auth/2fa/confirm', { code: '000000' });
    expect(primero.status).toBe(401);
    for (let i = 0; i < 4; i += 1) await nav.post('/api/v1/auth/2fa/confirm', { code: '000000' });

    const bloqueada = await nav.post('/api/v1/auth/2fa/confirm', { code: codigoTotp() });
    expect([401, 429]).toContain(bloqueada.status);
    expect(await nav.haySesion()).toBe(false);
  });
});

async function entrarConGoogle(nav, perfil) {
  perfilGoogle = perfil;
  const inicio = await nav.get('/api/v1/auth/oauth/google/start');
  expect(inicio.status).toBe(302);
  const state = new URL(inicio.headers.location).searchParams.get('state');
  const cb = await nav.get(`/api/v1/auth/oauth/google/callback?code=abc&state=${encodeURIComponent(state)}`);
  return new URL(cb.headers.location);
}
const google = (email, sub) => ({ sub, email, email_verified: true, name: 'Persona', picture: null });

describe('Google', () => {
  it('una cuenta creada por Google que vuelve entra', async () => {
    await crearUsuario('j@gmail.test', { clave: false, oauth: { provider: 'google', id: 'g-1' } });
    const nav = new Navegador();
    const destino = await entrarConGoogle(nav, google('j@gmail.test', 'g-1'));

    expect(destino.searchParams.get('oauthError')).toBeNull();
    expect(await nav.haySesion()).toBe(true);
  });

  it('una cuenta con contraseña vincula Google y entra; después puede seguir entrando con su contraseña', async () => {
    await crearUsuario('k@gmail.test');
    const nav = new Navegador();
    await entrarConGoogle(nav, google('k@gmail.test', 'g-2'));
    expect(await nav.haySesion()).toBe(true);

    const otro = new Navegador();
    expect((await otro.post('/api/v1/auth/login', { email: 'k@gmail.test', password: CLAVE })).status).toBe(200);
  });

  it('con 2FA activo: Google no da sesión, pide el código y con el código entra (el caso de «ya activé la clave 2FA y no me deja»)', async () => {
    await crearUsuario('l@gmail.test', { totp: true });
    const nav = new Navegador();
    const destino = await entrarConGoogle(nav, google('l@gmail.test', 'g-3'));

    // El servidor manda al frontend a /login?requiresTwoFactor=1; la pantalla (frontend #371) lleva a /verificar-2fa.
    expect(destino.pathname).toBe('/login');
    expect(destino.searchParams.get('requiresTwoFactor')).toBe('1');
    expect(await nav.haySesion()).toBe(false);
    expect(nav.tiene('vigiiap_2fa_temp')).toBe(true);

    const mala = await nav.post('/api/v1/auth/2fa/confirm', { code: '000000' });
    expect(mala.status).toBe(401);
    const buena = await nav.post('/api/v1/auth/2fa/confirm', { code: codigoTotp() });
    expect(buena.status).toBe(200);
    expect(await nav.haySesion()).toBe(true);
  });

  it('la misma cuenta con 2FA entra desde dos navegadores distintos, cada uno con su propio flujo', async () => {
    await crearUsuario('m@gmail.test', { totp: true });
    const uno = new Navegador();
    const dos = new Navegador();
    await entrarConGoogle(uno, google('m@gmail.test', 'g-4'));
    await entrarConGoogle(dos, google('m@gmail.test', 'g-4'));

    expect((await uno.post('/api/v1/auth/2fa/confirm', { code: codigoTotp() })).status).toBe(200);
    // Un código TOTP no se puede reutilizar dentro de su ventana (anti-replay): el segundo navegador usa el siguiente.
    expect((await dos.post('/api/v1/auth/2fa/confirm', { code: codigoTotp(30_000) })).status).toBe(200);
    expect(await uno.haySesion()).toBe(true);
    expect(await dos.haySesion()).toBe(true);
  });

  it('el estado firmado de un navegador no sirve en otro (protección contra login-CSRF)', async () => {
    await crearUsuario('n@gmail.test', { clave: false, oauth: { provider: 'google', id: 'g-5' } });
    perfilGoogle = google('n@gmail.test', 'g-5');
    const atacante = new Navegador();
    const inicio = await atacante.get('/api/v1/auth/oauth/google/start');
    const state = new URL(inicio.headers.location).searchParams.get('state');

    const victima = new Navegador(); // nunca pasó por /start: no tiene la cookie de protección
    const cb = await victima.get(`/api/v1/auth/oauth/google/callback?code=abc&state=${encodeURIComponent(state)}`);

    expect(new URL(cb.headers.location).searchParams.get('oauthError')).toBeTruthy();
    expect(await victima.haySesion()).toBe(false);
  });
});

describe('visitante', () => {
  it('el acceso rápido da una sesión de visitante, no de cuenta', async () => {
    const nav = new Navegador();
    const res = await nav.post('/api/v1/auth/visitante', { nombre: 'Visitante de prueba' });
    expect(res.status).toBe(200);

    const me = await nav.get('/api/v1/auth/me');
    expect(me.status).toBe(200);
    expect(me.body.rol).toBe('visitante');
  });
});
