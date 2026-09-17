import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../src/config/database.js', () => ({
  query: vi.fn(),
}));
vi.mock('../src/utils/auditLog.js', () => ({
  registrarAuditoria: vi.fn(),
}));
vi.mock('../src/modules/auth/auth.service.js', () => ({
  issueTokenPair: vi.fn().mockResolvedValue({ accessToken: 'access-tok', refreshToken: 'refresh-tok' }),
}));
vi.mock('../src/utils/logger.js', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

// Redis "no disponible" por defecto (isReady: false) — la mayoría de tests de
// handleCallback() no ejercitan PKCE en sí, así que fakeState() les da el
// code_verifier directamente en el state (ruta de degradación sin Redis,
// documentada en oauth.service.js). El describe "PKCE" de más abajo sí
// simula Redis disponible para probar la ruta principal.
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
  PROVIDERS: { google: mockGoogleProvider, microsoft: { id: 'microsoft', isConfigured: () => false }, apple: { id: 'apple', isConfigured: () => false } },
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

beforeEach(() => {
  vi.clearAllMocks();
  process.env.JWT_SECRET = 'test-secret-min-32-chars-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
  mockRedisClient.isReady = false;
});

describe('listProviders()', () => {
  it('refleja isConfigured() de cada adaptador', () => {
    expect(listProviders()).toEqual({ google: true, microsoft: false, apple: false });
  });
});

describe('buildAuthorizationUrl()', () => {
  it('devuelve la URL del proveedor con un state firmado y un code_challenge PKCE', async () => {
    const url = await buildAuthorizationUrl('google', REDIRECT_URI);
    expect(url).toContain('accounts.google.com');
    expect(mockGoogleProvider.getAuthorizationUrl).toHaveBeenCalledWith(
      expect.any(String), REDIRECT_URI, expect.any(String),
    );
  });

  it('lanza 404 para un proveedor inexistente', async () => {
    await expect(buildAuthorizationUrl('facebook', REDIRECT_URI)).rejects.toMatchObject({ status: 404 });
  });
});

function fakeState(provider = 'google', extra = { cv: 'test-code-verifier' }) {
  return jwt.sign({ provider, nonce: 'n', ...extra }, process.env.JWT_SECRET, { expiresIn: '10m' });
}

describe('handleCallback()', () => {
  it('rechaza un state inválido/expirado', async () => {
    await expect(handleCallback('google', 'code', 'basura-no-es-jwt', REDIRECT_URI))
      .rejects.toMatchObject({ status: 400 });
  });

  it('rechaza un state firmado para otro proveedor', async () => {
    const state = fakeState('microsoft');
    await expect(handleCallback('google', 'code', state, REDIRECT_URI))
      .rejects.toMatchObject({ status: 400 });
  });

  it('rechaza el perfil si el proveedor no confirma el correo', async () => {
    mockGoogleProvider.exchangeCodeForProfile.mockResolvedValueOnce({
      providerId: 'g-123', email: 'ana@gmail.com', emailVerified: false, nombre: 'Ana', avatarUrl: null,
    });
    await expect(handleCallback('google', 'code', fakeState(), REDIRECT_URI))
      .rejects.toMatchObject({ status: 400 });
  });

  it('vincula una cuenta existente por email en vez de duplicarla', async () => {
    mockGoogleProvider.exchangeCodeForProfile.mockResolvedValueOnce({
      providerId: 'g-123', email: 'ana@iiap.gov.co', emailVerified: true, nombre: 'Ana', avatarUrl: null,
    });
    query
      .mockResolvedValueOnce({ rows: [] }) // SELECT por (provider, oauth_id) — no existe
      .mockResolvedValueOnce({ rows: [{ id: 'existing-uuid', nombre: 'Ana', email: 'ana@iiap.gov.co', rol: 'investigador', activo: true, institucion: 'IIAP', avatar_url: null, perfil_completo: true }] }) // SELECT por email — existe
      .mockResolvedValueOnce({ rows: [] }); // UPDATE vincula oauth_provider/oauth_id

    const result = await handleCallback('google', 'code', fakeState(), REDIRECT_URI);

    expect(query.mock.calls[2][0]).toMatch(/SET oauth_provider/);
    expect(result.perfilCompleto).toBe(true);
    expect(issueTokenPair).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'existing-uuid' }),
      expect.any(Object)
    );
  });

  it('crea una cuenta nueva con rol publico y perfil_completo=false cuando no existe por provider ni por email', async () => {
    mockGoogleProvider.exchangeCodeForProfile.mockResolvedValueOnce({
      providerId: 'g-456', email: 'nueva@gmail.com', emailVerified: true, nombre: 'Nueva Persona', avatarUrl: 'https://x/y.png',
    });
    query
      .mockResolvedValueOnce({ rows: [] }) // por provider — no existe
      .mockResolvedValueOnce({ rows: [] }) // por email — no existe
      .mockResolvedValueOnce({ rows: [{ id: 'new-uuid', nombre: 'Nueva Persona', email: 'nueva@gmail.com', rol: 'publico', activo: true, institucion: null, avatar_url: 'https://x/y.png', perfil_completo: false }] }); // INSERT

    const result = await handleCallback('google', 'code', fakeState(), REDIRECT_URI);

    expect(query.mock.calls[2][0]).toMatch(/INSERT INTO usuarios/);
    expect(query.mock.calls[2][1]).toEqual(['Nueva Persona', 'nueva@gmail.com', 'google', 'g-456', 'https://x/y.png']);
    expect(result.perfilCompleto).toBe(false);
    expect(result.user).toMatchObject({ id: 'new-uuid', rol: 'publico' });
  });

  it('rechaza cuentas inactivas (pendientes de aprobación) tras encontrarlas', async () => {
    mockGoogleProvider.exchangeCodeForProfile.mockResolvedValueOnce({
      providerId: 'g-789', email: 'pendiente@iiap.gov.co', emailVerified: true, nombre: 'Pendiente', avatarUrl: null,
    });
    query.mockResolvedValueOnce({
      rows: [{ id: 'p-uuid', nombre: 'Pendiente', email: 'pendiente@iiap.gov.co', rol: 'publico', activo: false, institucion: null, avatar_url: null, perfil_completo: false }],
    });

    await expect(handleCallback('google', 'code', fakeState(), REDIRECT_URI))
      .rejects.toMatchObject({ status: 403, code: 'ACCOUNT_INACTIVE' });
  });

  it('el code_verifier del state llega intacto a exchangeCodeForProfile', async () => {
    mockGoogleProvider.exchangeCodeForProfile.mockResolvedValueOnce({
      providerId: 'g-1', email: 'ana@iiap.gov.co', emailVerified: true, nombre: 'Ana', avatarUrl: null,
    });
    query.mockResolvedValueOnce({
      rows: [{ id: 'u1', nombre: 'Ana', email: 'ana@iiap.gov.co', rol: 'publico', activo: true, institucion: null, avatar_url: null, perfil_completo: true }],
    });

    await handleCallback('google', 'code-abc', fakeState('google', { cv: 'el-verifier-correcto' }), REDIRECT_URI);

    expect(mockGoogleProvider.exchangeCodeForProfile).toHaveBeenCalledWith('code-abc', REDIRECT_URI, 'el-verifier-correcto');
  });
});

describe('PKCE — code_verifier vía Redis (ruta principal, sin degradar al state)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRedisClient.isReady = true;
  });

  it('buildAuthorizationUrl() guarda el code_verifier en Redis y NO lo incluye en el state', async () => {
    mockRedisClient.setEx.mockResolvedValue('OK');

    await buildAuthorizationUrl('google', REDIRECT_URI);

    expect(mockRedisClient.setEx).toHaveBeenCalledWith(
      expect.stringMatching(/^oauth:pkce:/), 600, expect.any(String),
    );
    const [state] = mockGoogleProvider.getAuthorizationUrl.mock.calls[0];
    const statePayload = jwt.decode(state);
    expect(statePayload.cv).toBeUndefined();
    expect(statePayload.nonce).toBeTruthy();
  });

  it('handleCallback() recupera el code_verifier de Redis usando el nonce del state y lo borra tras usarlo (un solo uso)', async () => {
    mockRedisClient.get.mockResolvedValue('verifier-desde-redis');
    mockRedisClient.del.mockResolvedValue(1);
    mockGoogleProvider.exchangeCodeForProfile.mockResolvedValueOnce({
      providerId: 'g-1', email: 'ana@iiap.gov.co', emailVerified: true, nombre: 'Ana', avatarUrl: null,
    });
    query.mockResolvedValueOnce({
      rows: [{ id: 'u1', nombre: 'Ana', email: 'ana@iiap.gov.co', rol: 'publico', activo: true, institucion: null, avatar_url: null, perfil_completo: true }],
    });

    const state = jwt.sign({ provider: 'google', nonce: 'abc123' }, process.env.JWT_SECRET, { expiresIn: '10m' });
    await handleCallback('google', 'code', state, REDIRECT_URI);

    expect(mockRedisClient.get).toHaveBeenCalledWith('oauth:pkce:abc123');
    expect(mockRedisClient.del).toHaveBeenCalledWith('oauth:pkce:abc123');
    expect(mockGoogleProvider.exchangeCodeForProfile).toHaveBeenCalledWith('code', REDIRECT_URI, 'verifier-desde-redis');
  });

  it('rechaza el callback si el nonce ya fue usado (Redis no tiene el verifier y el state tampoco lo trae)', async () => {
    mockRedisClient.get.mockResolvedValue(null);
    const state = jwt.sign({ provider: 'google', nonce: 'ya-usado' }, process.env.JWT_SECRET, { expiresIn: '10m' });

    await expect(handleCallback('google', 'code', state, REDIRECT_URI)).rejects.toMatchObject({ status: 400 });
    expect(mockGoogleProvider.exchangeCodeForProfile).not.toHaveBeenCalled();
  });
});
