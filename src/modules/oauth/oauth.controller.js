import crypto from 'crypto';
import * as oauthService from './oauth.service.js';
import {
  COOKIE_NAME, authCookieOptions,
  REFRESH_COOKIE_NAME, refreshCookieOptions,
} from '../../utils/cookieOptions.js';
import { notifyVerificacionEmail } from '../../utils/mailer.js';
import logger from '../../utils/logger.js';

const FRONTEND_URL = process.env.FRONTEND_URL || 'https://vigiiap.iiap.org.co';
const OAUTH_FLOW_PATH = '/api/auth/oauth';
const OAUTH_FLOW_MAX_AGE_MS = 10 * 60 * 1000; // igual a la vida del state JWT

function redirectUriFor(req, providerId) {
  // Debe coincidir exacto (esquema+host+path) con el registrado en la
  // consola del proveedor. BACKEND_PUBLIC_URL (fijo, validado una vez al
  // desplegar) es la fuente correcta -- req.get('host') lee el header Host
  // tal cual llegó, que un proxy con vhost no estricto puede dejar pasar con
  // un valor arbitrario del cliente (ver audit finding
  // oauth-redirect-uri-host-header-trust). Cae a req.get('host') solo si la
  // variable no está configurada, para no romper despliegues existentes
  // mientras se añade -- se registra una advertencia para que no quede así.
  const origen = process.env.BACKEND_PUBLIC_URL
    ? new URL(process.env.BACKEND_PUBLIC_URL).origin
    : `${req.protocol}://${req.get('host')}`;
  if (!process.env.BACKEND_PUBLIC_URL) {
    logger.warn('[oauth] BACKEND_PUBLIC_URL no está configurado -- redirect_uri se deriva del header Host de la petición, no de un origen fijo validado');
  }
  return `${origen}/api/v1/auth/oauth/${providerId}/callback`;
}

/** GET /api/v1/auth/oauth/providers — qué proveedores tienen credenciales configuradas */
export function listProviders(req, res) {
  res.json(oauthService.listProviders());
}

/** GET /api/v1/auth/oauth/:provider/start — redirige a la pantalla de consentimiento del proveedor */
export async function redirectToProvider(req, res, next) {
  try {
    // Cookie httpOnly propia de este navegador, atada al state firmado --
    // sin esto, un state firmado para la cuenta del ATACANTE (que el
    // atacante completó legítimamente) podía entregarse a una víctima y
    // loguearla como el atacante (login-CSRF). Ver audit finding
    // oauth-login-csrf-unbound-state.
    const csrf = crypto.randomBytes(16).toString('hex');
    const { url, codeVerifierCookie } = await oauthService.buildAuthorizationUrl(
      req.params.provider, redirectUriFor(req, req.params.provider), csrf,
    );
    res.cookie('vigiiap_oauth_csrf', csrf, {
      httpOnly: true, secure: true, sameSite: 'Lax', maxAge: OAUTH_FLOW_MAX_AGE_MS, path: OAUTH_FLOW_PATH,
    });
    if (codeVerifierCookie) {
      // Fallback sin Redis: el code_verifier viaja en una cookie httpOnly
      // propia, nunca en el state/URL (ver audit finding
      // oauth-pkce-fallback-verifier-in-state -- esa era la fuga).
      res.cookie('vigiiap_oauth_cv', codeVerifierCookie, {
        httpOnly: true, secure: true, sameSite: 'Lax', maxAge: OAUTH_FLOW_MAX_AGE_MS, path: OAUTH_FLOW_PATH,
      });
    }
    res.redirect(url);
  } catch (err) { next(err); }
}

/** GET /api/v1/auth/oauth/:provider/callback — intercambia el code y abre sesión */
export async function callback(req, res) {
  const { provider } = req.params;
  const { code, state, error: providerError } = req.query;

  if (providerError) {
    return res.redirect(`${FRONTEND_URL}/?oauthError=${encodeURIComponent(providerError)}`);
  }
  if (!code || !state) {
    return res.redirect(`${FRONTEND_URL}/?oauthError=missing_code`);
  }

  try {
    const ip        = req.ip;
    const userAgent = req.headers['user-agent'];
    const csrfCookieValor    = req.cookies?.vigiiap_oauth_csrf;
    const codeVerifierCookie = req.cookies?.vigiiap_oauth_cv ?? null;
    const result = await oauthService.handleCallback(provider, code, state, redirectUriFor(req, provider), {
      ip, userAgent, csrfCookieValor, codeVerifierCookie,
    });
    // Un solo uso cada una, hayan servido o no para esta llamada.
    res.clearCookie('vigiiap_oauth_csrf', { path: OAUTH_FLOW_PATH });
    res.clearCookie('vigiiap_oauth_cv', { path: OAUTH_FLOW_PATH });

    if (result.requiresEmailVerification) {
      // Cuenta nueva (ver oauth.service.js#findOrCreateUser) — nunca se
      // emite sesión sin que el correo quede confirmado primero. El email
      // se envía aquí, no en el servicio, igual que register() en
      // auth.controller.js: el token original solo existe en este valor de
      // retorno, nunca se guarda en claro.
      logger.info(`[oauth] Cuenta nueva vía ${provider} pendiente de verificar correo: ${result.email}`);
      notifyVerificacionEmail({
        email: result.email,
        nombre: result.nombre,
        verificationToken: result.verificationToken,
      }).catch((err) => logger.error(`[oauth] Error enviando verificación a ${result.email}:`, err.message));
      return res.redirect(`${FRONTEND_URL}/?oauthError=EMAIL_VERIFICATION_SENT`);
    }

    if (result.requiresTwoFactor) {
      // Misma cookie temporal que usa el login con contraseña — el
      // frontend debe pedir el código de 2FA y completar en
      // POST /api/auth/2fa/confirm antes de obtener sesión real.
      res.cookie('vigiiap_2fa_temp', result.twoFactorToken, {
        httpOnly: true, secure: true, sameSite: 'Lax',
        maxAge: 15 * 60 * 1000, path: '/api/auth/2fa/confirm',
      });
      return res.redirect(`${FRONTEND_URL}/login?requiresTwoFactor=1`);
    }

    res.cookie(COOKIE_NAME, result.accessToken, authCookieOptions());
    res.cookie(REFRESH_COOKIE_NAME, result.refreshToken, refreshCookieOptions());

    const params = result.perfilCompleto ? '' : '?completarPerfil=1';
    res.redirect(`${FRONTEND_URL}/${params}`);
  } catch (err) {
    logger.error(`[oauth] Callback de ${provider} falló:`, err.message);
    const errorCode = err.code || 'oauth_failed';
    res.redirect(`${FRONTEND_URL}/?oauthError=${encodeURIComponent(errorCode)}`);
  }
}
