/**
 * Adaptadores de proveedor OAuth — cada uno implementa la misma forma
 * (isConfigured/getAuthorizationUrl/exchangeCodeForProfile) para que
 * oauth.service.js y oauth.controller.js nunca conozcan las particularidades
 * de Google/Microsoft/Apple. Agregar un proveedor nuevo es solo escribir un
 * adaptador más y registrarlo en PROVIDERS — el resto del módulo no cambia.
 */
import logger from '../../utils/logger.js';

// ─── Google ───────────────────────────────────────────────────────────────
// https://developers.google.com/identity/protocols/oauth2/web-server
const googleProvider = {
  id: 'google',
  name: 'Google',

  isConfigured() {
    return Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
  },

  getAuthorizationUrl(state, redirectUri, codeChallenge) {
    const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
    url.searchParams.set('client_id', process.env.GOOGLE_CLIENT_ID);
    url.searchParams.set('redirect_uri', redirectUri);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('scope', 'openid email profile');
    url.searchParams.set('state', state);
    url.searchParams.set('prompt', 'select_account');
    // PKCE (RFC 7636) — capa extra aunque este sea un cliente confidencial
    // (ya usa client_secret): protege igual si el código de autorización
    // queda expuesto en un log intermedio (proxy, CDN, historial del
    // navegador) antes de que este backend lo canjee.
    url.searchParams.set('code_challenge', codeChallenge);
    url.searchParams.set('code_challenge_method', 'S256');
    return url.toString();
  },

  async exchangeCodeForProfile(code, redirectUri, codeVerifier) {
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id:     process.env.GOOGLE_CLIENT_ID,
        client_secret: process.env.GOOGLE_CLIENT_SECRET,
        redirect_uri:  redirectUri,
        grant_type:    'authorization_code',
        code_verifier: codeVerifier,
      }),
    });
    if (!tokenRes.ok) {
      logger.error(`[oauth] Google token exchange falló: ${tokenRes.status}`);
      throw Object.assign(new Error('No se pudo validar la cuenta de Google'), { status: 502 });
    }
    const { access_token: accessToken } = await tokenRes.json();

    const profileRes = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!profileRes.ok) {
      logger.error(`[oauth] Google userinfo falló: ${profileRes.status}`);
      throw Object.assign(new Error('No se pudo obtener el perfil de Google'), { status: 502 });
    }
    const profile = await profileRes.json();

    return {
      providerId:    profile.sub,
      email:         profile.email,
      emailVerified: profile.email_verified === true,
      nombre:        profile.name ?? profile.email,
      avatarUrl:     profile.picture ?? null,
    };
  },
};

// ─── Microsoft (Azure AD v2.0 / Entra ID) ────────────────────────────────
// https://learn.microsoft.com/azure/active-directory/develop/v2-oauth2-auth-code-flow
const microsoftProvider = {
  id: 'microsoft',
  name: 'Microsoft',

  isConfigured() {
    return Boolean(process.env.MICROSOFT_CLIENT_ID && process.env.MICROSOFT_CLIENT_SECRET);
  },

  getAuthorizationUrl(state, redirectUri, codeChallenge) {
    const tenant = process.env.MICROSOFT_TENANT_ID || 'common';
    const url = new URL(`https://login.microsoftonline.com/${tenant}/oauth2/v2.0/authorize`);
    url.searchParams.set('client_id', process.env.MICROSOFT_CLIENT_ID);
    url.searchParams.set('redirect_uri', redirectUri);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('scope', 'openid email profile User.Read');
    url.searchParams.set('state', state);
    url.searchParams.set('code_challenge', codeChallenge);
    url.searchParams.set('code_challenge_method', 'S256');
    return url.toString();
  },

  async exchangeCodeForProfile(code, redirectUri, codeVerifier) {
    const tenant = process.env.MICROSOFT_TENANT_ID || 'common';
    const tokenRes = await fetch(`https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id:     process.env.MICROSOFT_CLIENT_ID,
        client_secret: process.env.MICROSOFT_CLIENT_SECRET,
        redirect_uri:  redirectUri,
        grant_type:    'authorization_code',
        code_verifier: codeVerifier,
      }),
    });
    if (!tokenRes.ok) {
      logger.error(`[oauth] Microsoft token exchange falló: ${tokenRes.status}`);
      throw Object.assign(new Error('No se pudo validar la cuenta de Microsoft'), { status: 502 });
    }
    const { access_token: accessToken } = await tokenRes.json();

    const profileRes = await fetch('https://graph.microsoft.com/v1.0/me', {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!profileRes.ok) {
      logger.error(`[oauth] Microsoft Graph /me falló: ${profileRes.status}`);
      throw Object.assign(new Error('No se pudo obtener el perfil de Microsoft'), { status: 502 });
    }
    const profile = await profileRes.json();
    const email = profile.mail ?? profile.userPrincipalName;

    return {
      providerId:    profile.id,
      email,
      // Graph /me no expone verificación de email explícita — una cuenta
      // corporativa/Microsoft ya implica un correo controlado por el
      // proveedor, a diferencia de un formulario propio sin verificar.
      emailVerified: Boolean(email),
      nombre:        profile.displayName ?? email,
      avatarUrl:     null,
    };
  },
};

// Apple exige Apple Developer Program (de pago) + un client secret firmado
// con JWT (ES256, llave privada .p8) que se regenera cada ~6 meses — bastante
// más trabajo de configuración que Google/Microsoft. Se deja el contrato
// implementado como "no configurado" para que aparezca en /oauth/providers
// igual que los otros, listo para activarse el día que haya cuenta de Apple.
const appleProvider = {
  id: 'apple',
  name: 'Apple',
  isConfigured() {
    return false;
  },
  getAuthorizationUrl() {
    throw Object.assign(new Error('Apple Sign In no está configurado todavía'), { status: 501 });
  },
  async exchangeCodeForProfile() {
    throw Object.assign(new Error('Apple Sign In no está configurado todavía'), { status: 501 });
  },
};

export const PROVIDERS = {
  google:    googleProvider,
  microsoft: microsoftProvider,
  apple:     appleProvider,
};

export function getProvider(id) {
  const provider = PROVIDERS[id];
  if (!provider) {
    throw Object.assign(new Error(`Proveedor OAuth desconocido: ${id}`), { status: 404 });
  }
  return provider;
}
