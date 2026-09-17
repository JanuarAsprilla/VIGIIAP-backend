import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../src/modules/oauth/oauth.service.js', () => ({
  listProviders: vi.fn(),
  buildAuthorizationUrl: vi.fn(),
  handleCallback: vi.fn(),
}));
vi.mock('../src/utils/logger.js', () => ({
  default: { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() },
}));

import * as oauthService from '../src/modules/oauth/oauth.service.js';
import { listProviders, redirectToProvider, callback } from '../src/modules/oauth/oauth.controller.js';

const mockNext = vi.fn();

function res() {
  return { status: vi.fn().mockReturnThis(), json: vi.fn(), cookie: vi.fn(), redirect: vi.fn() };
}

function req(overrides = {}) {
  return {
    protocol: 'https',
    get: () => 'api.vigiiap.iiap.gov.co',
    params: {},
    query: {},
    ip: '127.0.0.1',
    headers: { 'user-agent': 'vitest' },
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.FRONTEND_URL = 'https://vigiiap.iiap.gov.co';
});

describe('oauth.controller → listProviders()', () => {
  it('devuelve el resultado de oauthService.listProviders() tal cual', () => {
    oauthService.listProviders.mockReturnValue({ google: true, microsoft: false });
    const r = res();
    listProviders(req(), r);
    expect(r.json).toHaveBeenCalledWith({ google: true, microsoft: false });
  });
});

describe('oauth.controller → redirectToProvider()', () => {
  it('redirige a la URL de autorización con el redirect_uri derivado del propio host', async () => {
    oauthService.buildAuthorizationUrl.mockResolvedValue('https://accounts.google.com/authorize?mock=1');
    const r = res();
    await redirectToProvider(req({ params: { provider: 'google' } }), r, mockNext);

    expect(oauthService.buildAuthorizationUrl).toHaveBeenCalledWith(
      'google',
      'https://api.vigiiap.iiap.gov.co/api/v1/auth/oauth/google/callback'
    );
    expect(r.redirect).toHaveBeenCalledWith('https://accounts.google.com/authorize?mock=1');
  });

  it('llama next(err) si el proveedor no está configurado', async () => {
    oauthService.buildAuthorizationUrl.mockRejectedValue(
      Object.assign(new Error('no configurado'), { status: 501 }),
    );
    await redirectToProvider(req({ params: { provider: 'microsoft' } }), res(), mockNext);
    expect(mockNext).toHaveBeenCalledWith(expect.objectContaining({ status: 501 }));
  });
});

describe('oauth.controller → callback()', () => {
  it('en éxito, pone las cookies de sesión y redirige a "/" sin query cuando el perfil está completo', async () => {
    oauthService.handleCallback.mockResolvedValue({
      accessToken: 'acc', refreshToken: 'ref', perfilCompleto: true, user: { id: 'u1' },
    });
    const r = res();

    await callback(req({ params: { provider: 'google' }, query: { code: 'c', state: 's' } }), r);

    expect(r.cookie).toHaveBeenCalledTimes(2);
    expect(r.redirect).toHaveBeenCalledWith('https://vigiiap.iiap.gov.co/');
  });

  it('agrega ?completarPerfil=1 cuando el perfil quedó incompleto (cuenta nueva sin institución)', async () => {
    oauthService.handleCallback.mockResolvedValue({
      accessToken: 'acc', refreshToken: 'ref', perfilCompleto: false, user: { id: 'u2' },
    });
    const r = res();

    await callback(req({ params: { provider: 'google' }, query: { code: 'c', state: 's' } }), r);

    expect(r.redirect).toHaveBeenCalledWith('https://vigiiap.iiap.gov.co/?completarPerfil=1');
  });

  it('redirige con oauthError si el proveedor devuelve un error (usuario canceló el consentimiento)', async () => {
    const r = res();
    await callback(req({ params: { provider: 'google' }, query: { error: 'access_denied' } }), r);
    expect(r.redirect).toHaveBeenCalledWith('https://vigiiap.iiap.gov.co/?oauthError=access_denied');
    expect(oauthService.handleCallback).not.toHaveBeenCalled();
  });

  it('redirige con oauthError=missing_code si faltan code o state', async () => {
    const r = res();
    await callback(req({ params: { provider: 'google' }, query: {} }), r);
    expect(r.redirect).toHaveBeenCalledWith('https://vigiiap.iiap.gov.co/?oauthError=missing_code');
  });

  it('redirige con oauthError cuando handleCallback lanza (no navega al frontend con la sesión a medias)', async () => {
    oauthService.handleCallback.mockRejectedValue(Object.assign(new Error('cuenta inactiva'), { code: 'ACCOUNT_INACTIVE' }));
    const r = res();

    await callback(req({ params: { provider: 'google' }, query: { code: 'c', state: 's' } }), r);

    expect(r.redirect).toHaveBeenCalledWith('https://vigiiap.iiap.gov.co/?oauthError=ACCOUNT_INACTIVE');
    expect(r.cookie).not.toHaveBeenCalled();
  });
});
