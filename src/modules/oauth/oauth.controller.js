import * as oauthService from './oauth.service.js';
import {
  COOKIE_NAME, authCookieOptions,
  REFRESH_COOKIE_NAME, refreshCookieOptions,
} from '../../utils/cookieOptions.js';
import logger from '../../utils/logger.js';

const FRONTEND_URL = process.env.FRONTEND_URL || 'https://vigiiap.iiap.org.co';

function redirectUriFor(req, providerId) {
  // Debe coincidir exacto (esquema+host+path) con el registrado en la
  // consola del proveedor — por eso se deriva del propio backend (mismo
  // origen que expone esta ruta) en vez de aceptar un valor del cliente.
  return `${req.protocol}://${req.get('host')}/api/v1/auth/oauth/${providerId}/callback`;
}

/** GET /api/v1/auth/oauth/providers — qué proveedores tienen credenciales configuradas */
export function listProviders(req, res) {
  res.json(oauthService.listProviders());
}

/** GET /api/v1/auth/oauth/:provider/start — redirige a la pantalla de consentimiento del proveedor */
export async function redirectToProvider(req, res, next) {
  try {
    const url = await oauthService.buildAuthorizationUrl(req.params.provider, redirectUriFor(req, req.params.provider));
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
    const result     = await oauthService.handleCallback(provider, code, state, redirectUriFor(req, provider), { ip, userAgent });

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
