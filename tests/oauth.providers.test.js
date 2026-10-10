import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../src/utils/logger.js', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import crypto from 'crypto';
import jwt from 'jsonwebtoken';

// jwks-rsa's getSigningKey() normally hits Microsoft's network JWKS
// endpoint — mocked here with a locally-generated RSA keypair so the
// Microsoft id_token signature path can be tested without network access.
const TEST_KID = 'test-kid-1';
const { publicKey: TEST_PUBLIC_KEY, privateKey: TEST_PRIVATE_KEY } = crypto.generateKeyPairSync('rsa', {
  modulusLength: 2048,
  publicKeyEncoding: { type: 'spki', format: 'pem' },
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
});

const { mockGetSigningKey } = vi.hoisted(() => ({ mockGetSigningKey: vi.fn() }));
vi.mock('jwks-rsa', () => ({
  default: vi.fn(() => ({ getSigningKey: mockGetSigningKey })),
}));

function signMsIdToken(claims, { kid = TEST_KID, key = TEST_PRIVATE_KEY } = {}) {
  return jwt.sign(claims, key, { algorithm: 'RS256', keyid: kid });
}

import { PROVIDERS, getProvider } from '../src/modules/oauth/oauth.providers.js';

const REDIRECT_URI = 'https://api.test/api/v1/auth/oauth/google/callback';
const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  vi.restoreAllMocks();
  process.env = { ...ORIGINAL_ENV };
  mockGetSigningKey.mockReset().mockImplementation((kid, cb) => {
    if (kid !== TEST_KID) return cb(new Error('kid desconocido'));
    cb(null, { getPublicKey: () => TEST_PUBLIC_KEY });
  });
});
afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

describe('getProvider()', () => {
  it('devuelve el adaptador registrado', () => {
    expect(getProvider('google')).toBe(PROVIDERS.google);
  });

  it('lanza 404 para un id desconocido', () => {
    expect(() => getProvider('facebook')).toThrow(expect.objectContaining({ status: 404 }));
  });
});

describe('googleProvider', () => {
  it('isConfigured() es false sin credenciales, true con ambas', () => {
    delete process.env.GOOGLE_CLIENT_ID;
    delete process.env.GOOGLE_CLIENT_SECRET;
    expect(PROVIDERS.google.isConfigured()).toBe(false);

    process.env.GOOGLE_CLIENT_ID = 'id';
    process.env.GOOGLE_CLIENT_SECRET = 'secret';
    expect(PROVIDERS.google.isConfigured()).toBe(true);
  });

  it('getAuthorizationUrl() arma la URL con client_id, redirect_uri, state y el challenge PKCE', () => {
    process.env.GOOGLE_CLIENT_ID = 'my-client-id';
    const url = new URL(PROVIDERS.google.getAuthorizationUrl('the-state', REDIRECT_URI, 'the-challenge'));
    expect(url.origin + url.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth');
    expect(url.searchParams.get('client_id')).toBe('my-client-id');
    expect(url.searchParams.get('redirect_uri')).toBe(REDIRECT_URI);
    expect(url.searchParams.get('state')).toBe('the-state');
    expect(url.searchParams.get('scope')).toContain('email');
    expect(url.searchParams.get('code_challenge')).toBe('the-challenge');
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
  });

  it('exchangeCodeForProfile() intercambia el code y normaliza el perfil de Google', async () => {
    process.env.GOOGLE_CLIENT_ID = 'id';
    process.env.GOOGLE_CLIENT_SECRET = 'secret';
    const fetchMock = vi.spyOn(global, 'fetch')
      .mockResolvedValueOnce({ ok: true, json: async () => ({ access_token: 'gh-token' }) })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ sub: 'g-1', email: 'ana@gmail.com', email_verified: true, name: 'Ana', picture: 'https://x/y.png' }),
      });

    const profile = await PROVIDERS.google.exchangeCodeForProfile('the-code', REDIRECT_URI, 'the-verifier');

    expect(profile).toEqual({
      providerId: 'g-1', email: 'ana@gmail.com', emailVerified: true, nombre: 'Ana', avatarUrl: 'https://x/y.png',
    });
    expect(fetchMock).toHaveBeenNthCalledWith(1, 'https://oauth2.googleapis.com/token', expect.objectContaining({ method: 'POST' }));
    const tokenBody = fetchMock.mock.calls[0][1].body;
    expect(tokenBody.get('code_verifier')).toBe('the-verifier');
    expect(fetchMock).toHaveBeenNthCalledWith(2, 'https://www.googleapis.com/oauth2/v3/userinfo', expect.objectContaining({
      headers: { Authorization: 'Bearer gh-token' },
    }));
  });

  it('exchangeCodeForProfile() lanza 502 si el intercambio de token falla', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValueOnce({ ok: false, status: 400 });
    await expect(PROVIDERS.google.exchangeCodeForProfile('bad-code', REDIRECT_URI))
      .rejects.toMatchObject({ status: 502 });
  });
});

describe('microsoftProvider', () => {
  it('usa el tenant "common" por defecto', () => {
    delete process.env.MICROSOFT_TENANT_ID;
    process.env.MICROSOFT_CLIENT_ID = 'ms-id';
    const url = new URL(PROVIDERS.microsoft.getAuthorizationUrl('state', REDIRECT_URI, 'challenge'));
    expect(url.pathname).toContain('/common/oauth2/v2.0/authorize');
    expect(url.searchParams.get('code_challenge')).toBe('challenge');
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
  });

  it('respeta MICROSOFT_TENANT_ID cuando está definido', () => {
    process.env.MICROSOFT_TENANT_ID = 'iiap-tenant';
    process.env.MICROSOFT_CLIENT_ID = 'ms-id';
    const url = new URL(PROVIDERS.microsoft.getAuthorizationUrl('state', REDIRECT_URI, 'challenge'));
    expect(url.pathname).toContain('/iiap-tenant/oauth2/v2.0/authorize');
  });

  it('exchangeCodeForProfile() valida el id_token firmado y usa su claim email, no el mail de Graph', async () => {
    process.env.MICROSOFT_CLIENT_ID = 'id';
    process.env.MICROSOFT_CLIENT_SECRET = 'secret';
    const idToken = signMsIdToken({
      iss: 'https://login.microsoftonline.com/some-tenant-id/v2.0',
      aud: 'id',
      oid: 'm-1',
      email: 'ana@empresa.com',
    });
    const fetchMock = vi.spyOn(global, 'fetch')
      .mockResolvedValueOnce({ ok: true, json: async () => ({ access_token: 'ms-token', id_token: idToken }) })
      // Graph /me solo aporta displayName, un dato no relevante para seguridad.
      .mockResolvedValueOnce({ ok: true, json: async () => ({ displayName: 'Ana' }) });

    const profile = await PROVIDERS.microsoft.exchangeCodeForProfile('code', REDIRECT_URI, 'ms-verifier');

    expect(profile).toEqual({ providerId: 'm-1', email: 'ana@empresa.com', emailVerified: true, nombre: 'Ana', avatarUrl: null });
    const tokenBody = fetchMock.mock.calls[0][1].body;
    expect(tokenBody.get('code_verifier')).toBe('ms-verifier');
  });

  it('exchangeCodeForProfile() usa preferred_username si el id_token no trae email', async () => {
    process.env.MICROSOFT_CLIENT_ID = 'id';
    process.env.MICROSOFT_CLIENT_SECRET = 'secret';
    const idToken = signMsIdToken({
      iss: 'https://login.microsoftonline.com/common/v2.0',
      aud: 'id',
      oid: 'm-2',
      preferred_username: 'ana@empresa.com',
    });
    vi.spyOn(global, 'fetch')
      .mockResolvedValueOnce({ ok: true, json: async () => ({ access_token: 'ms-token', id_token: idToken }) })
      .mockResolvedValueOnce({ ok: false });

    const profile = await PROVIDERS.microsoft.exchangeCodeForProfile('code', REDIRECT_URI, 'v');
    expect(profile.email).toBe('ana@empresa.com');
  });

  it('exchangeCodeForProfile() lanza 502 si el token de Microsoft no incluye id_token', async () => {
    process.env.MICROSOFT_CLIENT_ID = 'id';
    vi.spyOn(global, 'fetch').mockResolvedValueOnce({ ok: true, json: async () => ({ access_token: 'ms-token' }) });
    await expect(PROVIDERS.microsoft.exchangeCodeForProfile('code', REDIRECT_URI, 'v'))
      .rejects.toMatchObject({ status: 502 });
  });

  it('exchangeCodeForProfile() lanza 502 si la firma del id_token no coincide (clave distinta a la del JWKS)', async () => {
    process.env.MICROSOFT_CLIENT_ID = 'id';
    const { privateKey: otherKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048, publicKeyEncoding: { type: 'spki', format: 'pem' }, privateKeyEncoding: { type: 'pkcs8', format: 'pem' } });
    const forgedToken = signMsIdToken({ iss: 'https://login.microsoftonline.com/common/v2.0', aud: 'id', oid: 'm-3', email: 'ataque@evil.com' }, { key: otherKey });
    vi.spyOn(global, 'fetch').mockResolvedValueOnce({ ok: true, json: async () => ({ access_token: 'ms-token', id_token: forgedToken }) });
    await expect(PROVIDERS.microsoft.exchangeCodeForProfile('code', REDIRECT_URI, 'v'))
      .rejects.toMatchObject({ status: 502 });
  });

  it('exchangeCodeForProfile() lanza 502 si el emisor del id_token no es Microsoft', async () => {
    process.env.MICROSOFT_CLIENT_ID = 'id';
    const idToken = signMsIdToken({ iss: 'https://evil.example.com/v2.0', aud: 'id', oid: 'm-4', email: 'ataque@evil.com' });
    vi.spyOn(global, 'fetch').mockResolvedValueOnce({ ok: true, json: async () => ({ access_token: 'ms-token', id_token: idToken }) });
    await expect(PROVIDERS.microsoft.exchangeCodeForProfile('code', REDIRECT_URI, 'v'))
      .rejects.toMatchObject({ status: 502 });
  });

  it('exchangeCodeForProfile() lanza 502 si el id_token tiene una audiencia distinta a este client_id', async () => {
    process.env.MICROSOFT_CLIENT_ID = 'id-real';
    const idToken = signMsIdToken({ iss: 'https://login.microsoftonline.com/common/v2.0', aud: 'otra-app-cliente', oid: 'm-5', email: 'ataque@evil.com' });
    vi.spyOn(global, 'fetch').mockResolvedValueOnce({ ok: true, json: async () => ({ access_token: 'ms-token', id_token: idToken }) });
    await expect(PROVIDERS.microsoft.exchangeCodeForProfile('code', REDIRECT_URI, 'v'))
      .rejects.toMatchObject({ status: 502 });
  });
});

describe('PROVIDERS', () => {
  it('solo registra google y microsoft — Apple no está disponible (requiere Apple Developer Program de pago)', () => {
    expect(Object.keys(PROVIDERS).sort()).toEqual(['google', 'microsoft']);
  });
});
