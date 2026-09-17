import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../src/utils/logger.js', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { PROVIDERS, getProvider } from '../src/modules/oauth/oauth.providers.js';

const REDIRECT_URI = 'https://api.test/api/v1/auth/oauth/google/callback';
const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  vi.restoreAllMocks();
  process.env = { ...ORIGINAL_ENV };
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

  it('exchangeCodeForProfile() usa mail o userPrincipalName como email, y envía el code_verifier', async () => {
    process.env.MICROSOFT_CLIENT_ID = 'id';
    process.env.MICROSOFT_CLIENT_SECRET = 'secret';
    const fetchMock = vi.spyOn(global, 'fetch')
      .mockResolvedValueOnce({ ok: true, json: async () => ({ access_token: 'ms-token' }) })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ id: 'm-1', mail: null, userPrincipalName: 'ana@empresa.com', displayName: 'Ana' }),
      });

    const profile = await PROVIDERS.microsoft.exchangeCodeForProfile('code', REDIRECT_URI, 'ms-verifier');

    expect(profile).toMatchObject({ providerId: 'm-1', email: 'ana@empresa.com', emailVerified: true, nombre: 'Ana' });
    const tokenBody = fetchMock.mock.calls[0][1].body;
    expect(tokenBody.get('code_verifier')).toBe('ms-verifier');
  });
});

describe('PROVIDERS', () => {
  it('solo registra google y microsoft — Apple no está disponible (requiere Apple Developer Program de pago)', () => {
    expect(Object.keys(PROVIDERS).sort()).toEqual(['google', 'microsoft']);
  });
});
