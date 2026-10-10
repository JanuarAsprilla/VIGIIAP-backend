/**
 * Adaptadores de proveedor OAuth — cada uno implementa la misma forma
 * (isConfigured/getAuthorizationUrl/exchangeCodeForProfile) para que
 * oauth.service.js y oauth.controller.js nunca conozcan las particularidades
 * de cada proveedor. Agregar uno nuevo es solo escribir un adaptador más y
 * registrarlo en PROVIDERS — el resto del módulo no cambia.
 */
import jwt from 'jsonwebtoken';
import jwksClient from 'jwks-rsa';
import logger from '../../utils/logger.js';

// ─── Verificación de id_token de Microsoft ───────────────────────────────
// Graph /me no es una fuente verificada de identidad: su atributo `mail`
// puede editarlo el propio usuario en varias configuraciones de tenant
// (incluido un tenant Entra ID self-service gratuito). El id_token OIDC, en
// cambio, lo firma Microsoft con una llave RS256 publicada en su propio
// JWKS — verificar esa firma es la única forma de confiar en el claim de
// email sin depender de un atributo de directorio editable por el usuario.
const msJwks = jwksClient({
  jwksUri: 'https://login.microsoftonline.com/common/discovery/v2.0/keys',
  cache: true,
  cacheMaxAge: 24 * 60 * 60 * 1000,
  rateLimit: true,
});

function getMsSigningKey(kid) {
  return new Promise((resolve, reject) => {
    msJwks.getSigningKey(kid, (err, key) => {
      if (err) return reject(err);
      resolve(key.getPublicKey());
    });
  });
}

async function verifyMicrosoftIdToken(idToken) {
  const decoded = jwt.decode(idToken, { complete: true });
  const kid = decoded?.header?.kid;
  if (!kid) {
    throw new Error('id_token de Microsoft sin encabezado kid');
  }
  const publicKey = await getMsSigningKey(kid);
  const claims = jwt.verify(idToken, publicKey, {
    algorithms: ['RS256'],
    audience: process.env.MICROSOFT_CLIENT_ID,
  });
  // El emisor varía por tenant (.../<tenant-id>/v2.0) pero siempre vive bajo
  // el dominio de Microsoft identity platform — nunca aceptar un emisor
  // fuera de ese dominio, sin importar qué diga el payload.
  if (typeof claims.iss !== 'string' || !claims.iss.startsWith('https://login.microsoftonline.com/')) {
    throw new Error(`Emisor de id_token de Microsoft no reconocido: ${claims.iss}`);
  }
  return claims;
}

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
    const { access_token: accessToken, id_token: idToken } = await tokenRes.json();
    if (!idToken) {
      // Sin id_token no hay nada firmado por Microsoft que verificar — no
      // hay fallback seguro a Graph /me (ver verifyMicrosoftIdToken arriba).
      logger.error('[oauth] Microsoft no devolvió id_token (¿falta el scope openid?)');
      throw Object.assign(new Error('No se pudo verificar la identidad de Microsoft'), { status: 502 });
    }

    let claims;
    try {
      claims = await verifyMicrosoftIdToken(idToken);
    } catch (err) {
      logger.error(`[oauth] Verificación de id_token de Microsoft falló: ${err.message}`);
      throw Object.assign(new Error('No se pudo verificar la identidad de Microsoft'), { status: 502 });
    }

    // El claim `email` del id_token firmado reemplaza a Graph /me — Graph se
    // usa solo para el nombre a mostrar, un dato no relevante para seguridad.
    const email = claims.email ?? claims.preferred_username;
    if (!email) {
      throw Object.assign(new Error('Microsoft no compartió un correo verificable en el id_token'), { status: 400 });
    }

    const profileRes = await fetch('https://graph.microsoft.com/v1.0/me', {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    const profile = profileRes.ok ? await profileRes.json() : {};

    return {
      providerId:    claims.oid ?? claims.sub,
      email,
      // Ahora respaldado por la firma RS256 de Microsoft sobre el id_token,
      // no por un atributo de directorio (Graph `mail`) que el propio
      // usuario puede editar en un tenant Entra ID self-service.
      emailVerified: true,
      nombre:        profile.displayName ?? email,
      avatarUrl:     null,
    };
  },
};

// Apple Sign In queda fuera por ahora — exige Apple Developer Program (de
// pago, 99 USD/año) + un client secret firmado con JWT (ES256, llave privada
// .p8) que se regenera cada ~6 meses. Si el instituto decide activarlo más
// adelante, agregar un adaptador nuevo aquí con la misma forma
// (isConfigured/getAuthorizationUrl/exchangeCodeForProfile) y registrarlo en
// PROVIDERS — ni oauth.service.js ni oauth.controller.js necesitan cambios.

export const PROVIDERS = {
  google:    googleProvider,
  microsoft: microsoftProvider,
};

export function getProvider(id) {
  const provider = PROVIDERS[id];
  if (!provider) {
    throw Object.assign(new Error(`Proveedor OAuth desconocido: ${id}`), { status: 404 });
  }
  return provider;
}
