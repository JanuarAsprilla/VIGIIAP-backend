import { describe, it, expect, vi, beforeEach } from 'vitest';
import crypto from 'crypto';

vi.mock('../src/config/database.js', () => ({
  query: vi.fn(),
}));
vi.mock('../src/utils/auditLog.js', () => ({
  registrarAuditoria: vi.fn(),
}));
vi.mock('../src/modules/auth/auth.service.js', () => ({
  issueTokenPair: vi.fn().mockResolvedValue({ accessToken: 'access-tok', refreshToken: 'refresh-tok' }),
  generateSecureToken: vi.fn(() => 'raw-verification-token'),
  hashToken: vi.fn((t) => `hashed(${t})`),
}));
vi.mock('../src/utils/logger.js', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

// Redis "no disponible" por defecto (isReady: false) — la mayoría de tests de
// handleCallback() no ejercitan PKCE en sí, así que fakeState() les da el
// code_verifier vía codeVerifierCookie (ruta de degradación sin Redis). El
// describe "PKCE" de más abajo sí simula Redis disponible para la ruta
// principal.
const { mockRedisClient } = vi.hoisted(() => ({
  mockRedisClient: { isReady: false, setEx: vi.fn(), get: vi.fn(), del: vi.fn() },
}));
vi.mock('../src/middlewares/cache.js', () => ({
  getRedisClient: () => mockRedisClient,
}));

// vi.mock() se eleva (hoist) al inicio del módulo — cualquier valor que use su
// factory debe crearse dentro de vi.hoisted() para no leerse antes de existir.
const { mockGoogleProvider } = vi.hoisted(() => ({
  mockGoogleProvider: {
    id: 'google',
    name: 'Google',
    isConfigured: vi.fn().mockReturnValue(true),
    getAuthorizationUrl: vi.fn().mockReturnValue('https://accounts.google.com/o/oauth2/v2/auth?mock=1'),
    exchangeCodeForProfile: vi.fn(),
  },
}));
vi.mock('../src/modules/oauth/oauth.providers.js', () => ({
  PROVIDERS: { google: mockGoogleProvider, microsoft: { id: 'microsoft', isConfigured: () => false } },
  getProvider: vi.fn((id) => {
    if (id === 'google') return mockGoogleProvider;
    throw Object.assign(new Error(`Proveedor OAuth desconocido: ${id}`), { status: 404 });
  }),
}));

import jwt from 'jsonwebtoken';
import { query } from '../src/config/database.js';
import { issueTokenPair } from '../src/modules/auth/auth.service.js';
import {
  listProviders,
  buildAuthorizationUrl,
  handleCallback,
} from '../src/modules/oauth/oauth.service.js';

const REDIRECT_URI = 'https://api.vigiiap.iiap.gov.co/api/v1/auth/oauth/google/callback';
const CSRF_COOKIE = 'cookie-del-navegador-que-inicio-el-flujo';

function hashCsrf(valor) {
  return crypto.createHash('sha256').update(valor).digest('hex');
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.JWT_SECRET = 'test-secret-min-32-chars-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
  mockRedisClient.isReady = false;
});

describe('listProviders()', () => {
  it('refleja isConfigured() de cada adaptador', () => {
    expect(listProviders()).toEqual({ google: true, microsoft: false });
  });
});

describe('buildAuthorizationUrl()', () => {
  it('devuelve la URL del proveedor con un state firmado y un code_challenge PKCE', async () => {
    const { url } = await buildAuthorizationUrl('google', REDIRECT_URI, CSRF_COOKIE);
    expect(url).toContain('accounts.google.com');
    expect(mockGoogleProvider.getAuthorizationUrl).toHaveBeenCalledWith(
      expect.any(String), REDIRECT_URI, expect.any(String),
    );
  });

  it('el state firmado lleva el HASH de la cookie CSRF, nunca su valor en claro', async () => {
    await buildAuthorizationUrl('google', REDIRECT_URI, CSRF_COOKIE);
    const [state] = mockGoogleProvider.getAuthorizationUrl.mock.calls[0];
    const payload = jwt.decode(state);
    expect(payload.csrf).toBe(hashCsrf(CSRF_COOKIE));
  });

  it('sin Redis, devuelve codeVerifierCookie para que el controlador lo guarde en una cookie — nunca en el state', async () => {
    const { codeVerifierCookie } = await buildAuthorizationUrl('google', REDIRECT_URI, CSRF_COOKIE);
    expect(codeVerifierCookie).toBeTruthy();
    const [state] = mockGoogleProvider.getAuthorizationUrl.mock.calls[0];
    const payload = jwt.decode(state);
    expect(payload.cv).toBeUndefined();
  });

  it('lanza 404 para un proveedor inexistente', async () => {
    await expect(buildAuthorizationUrl('facebook', REDIRECT_URI, CSRF_COOKIE)).rejects.toMatchObject({ status: 404 });
  });
});

function fakeState(provider = 'google', { nonce = 'n', csrfCookieValor = CSRF_COOKIE } = {}) {
  return jwt.sign({ provider, nonce, csrf: hashCsrf(csrfCookieValor) }, process.env.JWT_SECRET, { expiresIn: '10m' });
}

// Opciones por defecto para handleCallback en los tests que no ejercitan la
// propia verificación CSRF: cookie y codeVerifierCookie "correctos", como si
// el navegador que llamó a /start fuera el mismo que llega a /callback.
function callbackOpts(overrides = {}) {
  return { csrfCookieValor: CSRF_COOKIE, codeVerifierCookie: 'test-code-verifier', ...overrides };
}

describe('handleCallback()', () => {
  it('rechaza un state inválido/expirado', async () => {
    await expect(handleCallback('google', 'code', 'basura-no-es-jwt', REDIRECT_URI, callbackOpts()))
      .rejects.toMatchObject({ status: 400 });
  });

  it('rechaza un state firmado para otro proveedor', async () => {
    const state = fakeState('microsoft');
    await expect(handleCallback('google', 'code', state, REDIRECT_URI, callbackOpts()))
      .rejects.toMatchObject({ status: 400 });
  });

  it('REGRESIÓN (login-CSRF): rechaza un state válido si la cookie CSRF del navegador no coincide (o falta) — ese state pudo ser de otro flujo', async () => {
    const state = fakeState('google', { csrfCookieValor: 'cookie-del-atacante' });
    await expect(handleCallback('google', 'code', state, REDIRECT_URI, callbackOpts({ csrfCookieValor: 'cookie-de-la-victima' })))
      .rejects.toMatchObject({ status: 400, code: 'OAUTH_CSRF_MISMATCH' });
    expect(mockGoogleProvider.exchangeCodeForProfile).not.toHaveBeenCalled();
  });

  it('REGRESIÓN (login-CSRF): rechaza si la cookie CSRF está ausente del todo', async () => {
    const state = fakeState('google');
    await expect(handleCallback('google', 'code', state, REDIRECT_URI, callbackOpts({ csrfCookieValor: undefined })))
      .rejects.toMatchObject({ status: 400, code: 'OAUTH_CSRF_MISMATCH' });
  });

  it('rechaza el perfil si el proveedor no confirma el correo', async () => {
    mockGoogleProvider.exchangeCodeForProfile.mockResolvedValueOnce({
      providerId: 'g-123', email: 'ana@gmail.com', emailVerified: false, nombre: 'Ana', avatarUrl: null,
    });
    await expect(handleCallback('google', 'code', fakeState(), REDIRECT_URI, callbackOpts()))
      .rejects.toMatchObject({ status: 400 });
  });

  it('vincula una cuenta existente por email en vez de duplicarla — solo si esa cuenta NUNCA tuvo contraseña propia', async () => {
    mockGoogleProvider.exchangeCodeForProfile.mockResolvedValueOnce({
      providerId: 'g-123', email: 'ana@iiap.gov.co', emailVerified: true, nombre: 'Ana', avatarUrl: null,
    });
    query
      .mockResolvedValueOnce({ rows: [] }) // SELECT por (provider, oauth_id) — no existe
      .mockResolvedValueOnce({ rows: [{ id: 'existing-uuid', nombre: 'Ana', email: 'ana@iiap.gov.co', rol: 'investigador', activo: true, email_verified: true, institucion: 'IIAP', avatar_url: null, perfil_completo: true, totp_enabled: false, password_hash: null }] }) // SELECT por email — existe, sin contraseña
      .mockResolvedValueOnce({ rows: [] }); // UPDATE vincula oauth_provider/oauth_id

    const result = await handleCallback('google', 'code', fakeState(), REDIRECT_URI, callbackOpts());

    expect(query.mock.calls[2][0]).toMatch(/SET oauth_provider/);
    expect(result.perfilCompleto).toBe(true);
    expect(issueTokenPair).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'existing-uuid' }),
      expect.any(Object)
    );
  });

  it('REGRESIÓN (account takeover): rechaza vincular por email si la cuenta existente tiene contraseña propia', async () => {
    mockGoogleProvider.exchangeCodeForProfile.mockResolvedValueOnce({
      providerId: 'atacante-oauth-id', email: 'victima-admin@iiap.gov.co', emailVerified: true, nombre: 'Atacante', avatarUrl: null,
    });
    query
      .mockResolvedValueOnce({ rows: [] }) // SELECT por (provider, oauth_id) — no existe
      .mockResolvedValueOnce({ rows: [{ id: 'victima-uuid', nombre: 'Víctima Admin', email: 'victima-admin@iiap.gov.co', rol: 'admin_sig', activo: true, email_verified: true, institucion: 'IIAP', avatar_url: null, perfil_completo: true, totp_enabled: false, password_hash: '$2a$12$hash-real-de-la-victima' }] }); // SELECT por email — tiene contraseña, correo YA verificado

    await expect(handleCallback('google', 'code', fakeState(), REDIRECT_URI, callbackOpts()))
      .rejects.toMatchObject({ status: 409, code: 'EMAIL_LINKED_TO_PASSWORD_ACCOUNT' });

    // Nunca debe llegar a vincular (UPDATE) ni a emitir tokens para la víctima.
    expect(query).toHaveBeenCalledTimes(2);
    expect(issueTokenPair).not.toHaveBeenCalled();
  });

  it('REGRESIÓN (pre-hijacking / backdoor de verificación): un correo "reservado" antes con contraseña pero SIN verificar se puede reclamar por OAuth — no bloquea con 409', async () => {
    mockGoogleProvider.exchangeCodeForProfile.mockResolvedValueOnce({
      providerId: 'victima-google-id', email: 'victima@gmail.com', emailVerified: true, nombre: 'Víctima Real', avatarUrl: null,
    });
    query
      .mockResolvedValueOnce({ rows: [] }) // SELECT por (provider, oauth_id) — no existe
      .mockResolvedValueOnce({ rows: [{ id: 'squat-uuid', nombre: 'Lo Que Sea', email: 'victima@gmail.com', rol: 'publico', activo: false, email_verified: false, email_verification_expires: new Date(Date.now() - 60 * 60 * 1000), institucion: null, avatar_url: null, perfil_completo: false, totp_enabled: false, password_hash: '$2a$12$hash-de-quien-reservo-el-correo' }] }) // SELECT por email — reservado por registro con contraseña, YA EXPIRADO sin verificar
      .mockResolvedValueOnce({ rows: [{ id: 'squat-uuid', nombre: 'Víctima Real', email: 'victima@gmail.com', rol: 'publico', activo: false, institucion: null, avatar_url: null, perfil_completo: false, email_verified: false }] }); // UPDATE reclama la fila

    const result = await handleCallback('google', 'code', fakeState(), REDIRECT_URI, callbackOpts());

    expect(query.mock.calls[2][0]).toMatch(/UPDATE usuarios/);
    expect(query.mock.calls[2][0]).toMatch(/password_hash = NULL/);
    expect(query.mock.calls[2][0]).toMatch(/email_verified = false/);
    expect(result).toMatchObject({ requiresEmailVerification: true, isNewAccount: true, email: 'victima@gmail.com' });
    expect(issueTokenPair).not.toHaveBeenCalled();
  });

  it('REGRESIÓN (pre-hijacking / backdoor de verificación): un correo vinculado antes a OTRO proveedor pero SIN verificar también se puede reclamar', async () => {
    mockGoogleProvider.exchangeCodeForProfile.mockResolvedValueOnce({
      providerId: 'victima-google-id', email: 'victima2@gmail.com', emailVerified: true, nombre: 'Víctima Real', avatarUrl: null,
    });
    query
      .mockResolvedValueOnce({ rows: [] }) // SELECT por (provider, oauth_id) — no existe
      .mockResolvedValueOnce({ rows: [{ id: 'squat-uuid-2', nombre: 'Atacante', email: 'victima2@gmail.com', rol: 'publico', activo: true, email_verified: false, email_verification_expires: new Date(Date.now() - 60 * 60 * 1000), institucion: null, avatar_url: null, perfil_completo: false, totp_enabled: false, password_hash: null, oauth_provider: 'microsoft' }] }) // SELECT por email — squat previo por otro proveedor, YA EXPIRADO sin verificar
      .mockResolvedValueOnce({ rows: [{ id: 'squat-uuid-2', nombre: 'Víctima Real', email: 'victima2@gmail.com', rol: 'publico', activo: true, institucion: null, avatar_url: null, perfil_completo: false, email_verified: false }] });

    const result = await handleCallback('google', 'code', fakeState(), REDIRECT_URI, callbackOpts());

    expect(query.mock.calls[2][1]).toEqual(['google', 'victima-google-id', expect.any(String), expect.any(Date), 'squat-uuid-2']);
    expect(result.requiresEmailVerification).toBe(true);
    expect(issueTokenPair).not.toHaveBeenCalled();
  });

  it('REGRESIÓN (carrera): si el correo se verificó justo entre el SELECT y el reclamo, lanza 409 en vez de pisar la cuenta ya confirmada', async () => {
    mockGoogleProvider.exchangeCodeForProfile.mockResolvedValueOnce({
      providerId: 'victima-google-id', email: 'victima3@gmail.com', emailVerified: true, nombre: 'Víctima Real', avatarUrl: null,
    });
    query
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ id: 'squat-uuid-3', nombre: 'Lo Que Sea', email: 'victima3@gmail.com', rol: 'publico', activo: true, email_verified: false, email_verification_expires: new Date(Date.now() - 60 * 60 * 1000), institucion: null, avatar_url: null, perfil_completo: false, totp_enabled: false, password_hash: null }] })
      .mockResolvedValueOnce({ rows: [] }); // UPDATE con WHERE email_verified=false no afectó ninguna fila -- ya se verificó

    await expect(handleCallback('google', 'code', fakeState(), REDIRECT_URI, callbackOpts()))
      .rejects.toMatchObject({ status: 409, code: 'EMAIL_VERIFICATION_PENDING' });
    expect(issueTokenPair).not.toHaveBeenCalled();
  });

  it('REGRESIÓN (account takeover / carrera de reclamo): si el enlace de verificación anterior TODAVÍA está vigente, bloquea el reclamo en vez de pisar un registro de buena fe en curso', async () => {
    mockGoogleProvider.exchangeCodeForProfile.mockResolvedValueOnce({
      providerId: 'atacante-google-id', email: 'victima4@gmail.com', emailVerified: true, nombre: 'Atacante', avatarUrl: null,
    });
    query
      .mockResolvedValueOnce({ rows: [] }) // SELECT por (provider, oauth_id) — no existe
      .mockResolvedValueOnce({ rows: [{ id: 'buena-fe-uuid', nombre: 'Dueña Real', email: 'victima4@gmail.com', rol: 'publico', activo: true, email_verified: false, email_verification_expires: new Date(Date.now() + 60 * 60 * 1000), institucion: null, avatar_url: null, perfil_completo: false, totp_enabled: false, password_hash: '$2a$12$hash-de-la-dueña-real' }] }); // registro propio, su enlace sigue vigente

    await expect(handleCallback('google', 'code', fakeState(), REDIRECT_URI, callbackOpts()))
      .rejects.toMatchObject({ status: 409, code: 'EMAIL_VERIFICATION_PENDING' });

    // No debe llegar a pisar la fila (ni UPDATE) ni emitir tokens para el atacante.
    expect(query).toHaveBeenCalledTimes(2);
    expect(issueTokenPair).not.toHaveBeenCalled();
  });

  it('REGRESIÓN (bypass de 2FA): no emite sesión completa si la cuenta encontrada tiene totp_enabled — pide el segundo factor', async () => {
    mockGoogleProvider.exchangeCodeForProfile.mockResolvedValueOnce({
      providerId: 'g-2fa', email: 'con2fa@iiap.gov.co', emailVerified: true, nombre: 'Con 2FA', avatarUrl: null,
    });
    query.mockResolvedValueOnce({
      rows: [{ id: 'u-2fa', nombre: 'Con 2FA', email: 'con2fa@iiap.gov.co', rol: 'admin_sig', activo: true, email_verified: true, institucion: null, avatar_url: null, perfil_completo: true, totp_enabled: true }],
    });

    const result = await handleCallback('google', 'code', fakeState(), REDIRECT_URI, callbackOpts());

    expect(result.requiresTwoFactor).toBe(true);
    expect(result.twoFactorToken).toBeTruthy();
    const decoded = jwt.decode(result.twoFactorToken);
    expect(decoded).toMatchObject({ id: 'u-2fa', scope: '2fa' });
    expect(issueTokenPair).not.toHaveBeenCalled();
  });

  it('REGRESIÓN (nOAuth / email squatting): cuenta nueva se crea con email_verified=false y NO abre sesión — exige verificar el correo primero', async () => {
    mockGoogleProvider.exchangeCodeForProfile.mockResolvedValueOnce({
      providerId: 'g-456', email: 'nueva@gmail.com', emailVerified: true, nombre: 'Nueva Persona', avatarUrl: 'https://x/y.png',
    });
    query
      .mockResolvedValueOnce({ rows: [] }) // por provider — no existe
      .mockResolvedValueOnce({ rows: [] }) // por email — no existe
      .mockResolvedValueOnce({ rows: [{ id: 'new-uuid', nombre: 'Nueva Persona', email: 'nueva@gmail.com', rol: 'publico', activo: true, email_verified: false, institucion: null, avatar_url: 'https://x/y.png', perfil_completo: false }] }); // INSERT

    const result = await handleCallback('google', 'code', fakeState(), REDIRECT_URI, callbackOpts());

    expect(query.mock.calls[2][0]).toMatch(/INSERT INTO usuarios/);
    expect(query.mock.calls[2][0]).toMatch(/email_verification_token/);
    // 'publico', activo=true, email_verified=false son literales en el VALUES — solo
    // nombre/email/token-hasheado/expiración/provider/providerId/avatarUrl son placeholders.
    expect(query.mock.calls[2][1]).toEqual([
      'Nueva Persona', 'nueva@gmail.com',
      'hashed(raw-verification-token)', expect.any(Date),
      'google', 'g-456', 'https://x/y.png',
    ]);
    expect(result).toEqual({
      requiresEmailVerification: true,
      isNewAccount: true,
      email: 'nueva@gmail.com',
      nombre: 'Nueva Persona',
      verificationToken: 'raw-verification-token',
    });
    expect(issueTokenPair).not.toHaveBeenCalled();
  });

  it('REGRESIÓN (nOAuth / email squatting): una cuenta ya creada por OAuth pero aún sin verificar (reintento) se bloquea en vez de abrir sesión', async () => {
    mockGoogleProvider.exchangeCodeForProfile.mockResolvedValueOnce({
      providerId: 'g-456', email: 'nueva@gmail.com', emailVerified: true, nombre: 'Nueva Persona', avatarUrl: null,
    });
    query.mockResolvedValueOnce({
      rows: [{ id: 'new-uuid', nombre: 'Nueva Persona', email: 'nueva@gmail.com', rol: 'publico', activo: true, email_verified: false, institucion: null, avatar_url: null, perfil_completo: false, totp_enabled: false }],
    }); // encontrada por (provider, oauth_id) — ya existía de un intento anterior sin verificar

    await expect(handleCallback('google', 'code', fakeState(), REDIRECT_URI, callbackOpts()))
      .rejects.toMatchObject({ status: 403, code: 'EMAIL_NOT_VERIFIED' });
    expect(issueTokenPair).not.toHaveBeenCalled();
  });

  it('rechaza cuentas inactivas (pendientes de aprobación) tras encontrarlas', async () => {
    mockGoogleProvider.exchangeCodeForProfile.mockResolvedValueOnce({
      providerId: 'g-789', email: 'pendiente@iiap.gov.co', emailVerified: true, nombre: 'Pendiente', avatarUrl: null,
    });
    query.mockResolvedValueOnce({
      rows: [{ id: 'p-uuid', nombre: 'Pendiente', email: 'pendiente@iiap.gov.co', rol: 'publico', activo: false, email_verified: true, institucion: null, avatar_url: null, perfil_completo: false }],
    });

    await expect(handleCallback('google', 'code', fakeState(), REDIRECT_URI, callbackOpts()))
      .rejects.toMatchObject({ status: 403, code: 'ACCOUNT_INACTIVE' });
  });

  it('el code_verifier de la cookie (fallback sin Redis) llega intacto a exchangeCodeForProfile', async () => {
    mockGoogleProvider.exchangeCodeForProfile.mockResolvedValueOnce({
      providerId: 'g-1', email: 'ana@iiap.gov.co', emailVerified: true, nombre: 'Ana', avatarUrl: null,
    });
    query.mockResolvedValueOnce({
      rows: [{ id: 'u1', nombre: 'Ana', email: 'ana@iiap.gov.co', rol: 'publico', activo: true, email_verified: true, institucion: null, avatar_url: null, perfil_completo: true }],
    });

    await handleCallback('google', 'code-abc', fakeState(), REDIRECT_URI, callbackOpts({ codeVerifierCookie: 'el-verifier-correcto' }));

    expect(mockGoogleProvider.exchangeCodeForProfile).toHaveBeenCalledWith('code-abc', REDIRECT_URI, 'el-verifier-correcto');
  });
});

describe('PKCE — code_verifier vía Redis (ruta principal, sin degradar a cookie)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRedisClient.isReady = true;
  });

  it('buildAuthorizationUrl() guarda el code_verifier en Redis y no pide cookie de fallback (codeVerifierCookie=null)', async () => {
    mockRedisClient.setEx.mockResolvedValue('OK');

    const { codeVerifierCookie } = await buildAuthorizationUrl('google', REDIRECT_URI, CSRF_COOKIE);

    expect(mockRedisClient.setEx).toHaveBeenCalledWith(
      expect.stringMatching(/^oauth:pkce:/), 600, expect.any(String),
    );
    expect(codeVerifierCookie).toBeNull();
    const [state] = mockGoogleProvider.getAuthorizationUrl.mock.calls[0];
    const statePayload = jwt.decode(state);
    expect(statePayload.cv).toBeUndefined();
    expect(statePayload.nonce).toBeTruthy();
  });

  it('handleCallback() recupera el code_verifier de Redis usando el nonce del state y lo borra tras usarlo (un solo uso) — ignora cualquier cookie', async () => {
    mockRedisClient.get.mockResolvedValue('verifier-desde-redis');
    mockRedisClient.del.mockResolvedValue(1);
    mockGoogleProvider.exchangeCodeForProfile.mockResolvedValueOnce({
      providerId: 'g-1', email: 'ana@iiap.gov.co', emailVerified: true, nombre: 'Ana', avatarUrl: null,
    });
    query.mockResolvedValueOnce({
      rows: [{ id: 'u1', nombre: 'Ana', email: 'ana@iiap.gov.co', rol: 'publico', activo: true, email_verified: true, institucion: null, avatar_url: null, perfil_completo: true }],
    });

    const state = fakeState('google', { nonce: 'abc123' });
    await handleCallback('google', 'code', state, REDIRECT_URI, callbackOpts({ codeVerifierCookie: null }));

    expect(mockRedisClient.get).toHaveBeenCalledWith('oauth:pkce:abc123');
    expect(mockRedisClient.del).toHaveBeenCalledWith('oauth:pkce:abc123');
    expect(mockGoogleProvider.exchangeCodeForProfile).toHaveBeenCalledWith('code', REDIRECT_URI, 'verifier-desde-redis');
  });

  it('rechaza el callback si el nonce ya fue usado (Redis no tiene el verifier y no hay cookie de fallback)', async () => {
    mockRedisClient.get.mockResolvedValue(null);
    const state = fakeState('google', { nonce: 'ya-usado' });

    await expect(handleCallback('google', 'code', state, REDIRECT_URI, callbackOpts({ codeVerifierCookie: null })))
      .rejects.toMatchObject({ status: 400 });
    expect(mockGoogleProvider.exchangeCodeForProfile).not.toHaveBeenCalled();
  });
});
