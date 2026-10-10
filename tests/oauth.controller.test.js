import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../src/modules/oauth/oauth.service.js', () => ({
  listProviders: vi.fn(),
  buildAuthorizationUrl: vi.fn(),
  handleCallback: vi.fn(),
}));
vi.mock('../src/utils/logger.js', () => ({
  default: { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() },
}));
vi.mock('../src/utils/mailer.js', () => ({
  notifyVerificacionEmail: vi.fn().mockResolvedValue(undefined),
}));

import * as oauthService from '../src/modules/oauth/oauth.service.js';
import * as mailer from '../src/utils/mailer.js';
import { listProviders, redirectToProvider, callback } from '../src/modules/oauth/oauth.controller.js';

const mockNext = vi.fn();

function res() {
  return { status: vi.fn().mockReturnThis(), json: vi.fn(), cookie: vi.fn(), clearCookie: vi.fn(), redirect: vi.fn() };
}

function req(overrides = {}) {
  return {
    protocol: 'https',
    get: () => 'api.vigiiap.iiap.gov.co',
    params: {},
    query: {},
    cookies: {},
    ip: '127.0.0.1',
    headers: { 'user-agent': 'vitest' },
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.FRONTEND_URL = 'https://vigiiap.iiap.org.co';
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
  it('redirige a la URL de autorización, con el redirect_uri derivado del propio host y una cookie CSRF httpOnly propia', async () => {
    oauthService.buildAuthorizationUrl.mockResolvedValue({ url: 'https://accounts.google.com/authorize?mock=1', codeVerifierCookie: null });
    const r = res();
    await redirectToProvider(req({ params: { provider: 'google' } }), r, mockNext);

    expect(oauthService.buildAuthorizationUrl).toHaveBeenCalledWith(
      'google',
      'https://api.vigiiap.iiap.gov.co/api/v1/auth/oauth/google/callback',
      expect.any(String),
    );
    expect(r.cookie).toHaveBeenCalledWith('vigiiap_oauth_csrf', expect.any(String), expect.objectContaining({ httpOnly: true }));
    expect(r.redirect).toHaveBeenCalledWith('https://accounts.google.com/authorize?mock=1');
  });

  it('cuando no hay Redis (codeVerifierCookie presente), también pone la cookie httpOnly del code_verifier', async () => {
    oauthService.buildAuthorizationUrl.mockResolvedValue({ url: 'https://accounts.google.com/authorize?mock=1', codeVerifierCookie: 'el-verifier' });
    const r = res();
    await redirectToProvider(req({ params: { provider: 'google' } }), r, mockNext);

    expect(r.cookie).toHaveBeenCalledWith('vigiiap_oauth_cv', 'el-verifier', expect.objectContaining({ httpOnly: true }));
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
    expect(r.clearCookie).toHaveBeenCalledWith('vigiiap_oauth_csrf', expect.any(Object));
    expect(r.clearCookie).toHaveBeenCalledWith('vigiiap_oauth_cv', expect.any(Object));
    expect(r.redirect).toHaveBeenCalledWith('https://vigiiap.iiap.org.co/');
  });

  it('agrega ?completarPerfil=1 cuando el perfil quedó incompleto (cuenta nueva sin institución)', async () => {
    oauthService.handleCallback.mockResolvedValue({
      accessToken: 'acc', refreshToken: 'ref', perfilCompleto: false, user: { id: 'u2' },
    });
    const r = res();

    await callback(req({ params: { provider: 'google' }, query: { code: 'c', state: 's' } }), r);

    expect(r.redirect).toHaveBeenCalledWith('https://vigiiap.iiap.org.co/?completarPerfil=1');
  });

  it('redirige con oauthError si el proveedor devuelve un error (usuario canceló el consentimiento)', async () => {
    const r = res();
    await callback(req({ params: { provider: 'google' }, query: { error: 'access_denied' } }), r);
    expect(r.redirect).toHaveBeenCalledWith('https://vigiiap.iiap.org.co/?oauthError=access_denied');
    expect(oauthService.handleCallback).not.toHaveBeenCalled();
  });

  it('redirige con oauthError=missing_code si faltan code o state', async () => {
    const r = res();
    await callback(req({ params: { provider: 'google' }, query: {} }), r);
    expect(r.redirect).toHaveBeenCalledWith('https://vigiiap.iiap.org.co/?oauthError=missing_code');
  });

  it('REGRESIÓN (bypass de 2FA): si handleCallback pide el segundo factor, pone solo la cookie temporal y NO la de sesión', async () => {
    oauthService.handleCallback.mockResolvedValue({ requiresTwoFactor: true, twoFactorToken: 'temp-2fa-tok' });
    const r = res();

    await callback(req({ params: { provider: 'google' }, query: { code: 'c', state: 's' } }), r);

    expect(r.cookie).toHaveBeenCalledTimes(1);
    expect(r.cookie).toHaveBeenCalledWith('vigiiap_2fa_temp', 'temp-2fa-tok', expect.objectContaining({
      httpOnly: true, path: '/api/auth/2fa/confirm',
    }));
    expect(r.redirect).toHaveBeenCalledWith('https://vigiiap.iiap.org.co/login?requiresTwoFactor=1');
  });

  it('REGRESIÓN (nOAuth / email squatting): si handleCallback pide verificar el correo (cuenta nueva), envía el email y NO pone cookies de sesión', async () => {
    oauthService.handleCallback.mockResolvedValue({
      requiresEmailVerification: true, isNewAccount: true,
      email: 'nueva@gmail.com', nombre: 'Nueva Persona', verificationToken: 'raw-tok',
    });
    const r = res();

    await callback(req({ params: { provider: 'google' }, query: { code: 'c', state: 's' } }), r);

    expect(mailer.notifyVerificacionEmail).toHaveBeenCalledWith({
      email: 'nueva@gmail.com', nombre: 'Nueva Persona', verificationToken: 'raw-tok',
    });
    expect(r.cookie).not.toHaveBeenCalled();
    expect(r.redirect).toHaveBeenCalledWith('https://vigiiap.iiap.org.co/?oauthError=EMAIL_VERIFICATION_SENT');
  });

  it('redirige con oauthError cuando handleCallback lanza (no navega al frontend con la sesión a medias)', async () => {
    oauthService.handleCallback.mockRejectedValue(Object.assign(new Error('cuenta inactiva'), { code: 'ACCOUNT_INACTIVE' }));
    const r = res();

    await callback(req({ params: { provider: 'google' }, query: { code: 'c', state: 's' } }), r);

    expect(r.redirect).toHaveBeenCalledWith('https://vigiiap.iiap.org.co/?oauthError=ACCOUNT_INACTIVE');
    expect(r.cookie).not.toHaveBeenCalled();
  });
});
