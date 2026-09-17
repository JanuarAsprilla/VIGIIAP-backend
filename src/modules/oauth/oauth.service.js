import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { query } from '../../config/database.js';
import { getProvider, PROVIDERS } from './oauth.providers.js';
import { issueTokenPair } from '../auth/auth.service.js';
import { registrarAuditoria } from '../../utils/auditLog.js';
import { getRedisClient } from '../../middlewares/cache.js';
import logger from '../../utils/logger.js';

// El "state" del flujo OAuth viaja como JWT de vida corta en vez de guardarse
// en BD — no hay estado de sesión previo al callback (el navegador va y
// vuelve del proveedor externo), así que firmar el proveedor+nonce y
// verificarlo al volver es suficiente para CSRF sin infraestructura extra.
function signState(providerId, nonce, codeVerifierFallback) {
  const payload = { provider: providerId, nonce };
  // Solo viaja en el propio state si Redis no está disponible (ver
  // storeCodeVerifier) — degradado pero funcional, igual que cache.js.
  if (codeVerifierFallback) payload.cv = codeVerifierFallback;
  return jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: '10m' });
}

function verifyState(rawState, expectedProvider) {
  let payload;
  try {
    payload = jwt.verify(rawState, process.env.JWT_SECRET);
  } catch {
    throw Object.assign(new Error('El enlace de inicio de sesión expiró o no es válido. Intenta de nuevo.'), { status: 400 });
  }
  if (payload.provider !== expectedProvider) {
    throw Object.assign(new Error('El enlace de inicio de sesión no corresponde a este proveedor.'), { status: 400 });
  }
  return payload;
}

// ─── PKCE (RFC 7636) ─────────────────────────────────────────────────────
// Capa extra sobre el client_secret que ya usa este flujo (cliente
// confidencial) — protege también si el `code` queda expuesto en un canal
// intermedio (proxy, CDN, historial del navegador) antes de que este backend
// lo canjee. El code_verifier se guarda server-side en Redis, atado al mismo
// nonce que ya viaja en el state — nunca pasa por el navegador. Si Redis no
// está configurado, cae al mismo state JWT (degradado, no roto).
const PKCE_TTL_SECONDS = 600; // igual a la vida del state JWT

function generatePkce() {
  const codeVerifier = crypto.randomBytes(32).toString('base64url');
  const codeChallenge = crypto.createHash('sha256').update(codeVerifier).digest('base64url');
  return { codeVerifier, codeChallenge };
}

async function storeCodeVerifier(nonce, codeVerifier) {
  const client = getRedisClient();
  if (!client?.isReady) return false;
  try {
    await client.setEx(`oauth:pkce:${nonce}`, PKCE_TTL_SECONDS, codeVerifier);
    return true;
  } catch (err) {
    logger.warn(`[oauth] No se pudo guardar code_verifier en Redis: ${err.message}`);
    return false;
  }
}

async function consumeCodeVerifier(nonce) {
  const client = getRedisClient();
  if (!client?.isReady) return null;
  try {
    const key = `oauth:pkce:${nonce}`;
    const verifier = await client.get(key);
    if (verifier) await client.del(key); // un solo uso
    return verifier;
  } catch (err) {
    logger.warn(`[oauth] No se pudo leer code_verifier de Redis: ${err.message}`);
    return null;
  }
}

export function listProviders() {
  return Object.fromEntries(
    Object.values(PROVIDERS).map((p) => [p.id, p.isConfigured()]),
  );
}

export async function buildAuthorizationUrl(providerId, redirectUri) {
  const provider = getProvider(providerId);
  if (!provider.isConfigured()) {
    throw Object.assign(new Error(`El inicio de sesión con ${provider.name} todavía no está disponible.`), { status: 501 });
  }
  const nonce = crypto.randomBytes(16).toString('hex');
  const { codeVerifier, codeChallenge } = generatePkce();
  const storedInRedis = await storeCodeVerifier(nonce, codeVerifier);
  const state = signState(providerId, nonce, storedInRedis ? undefined : codeVerifier);
  return provider.getAuthorizationUrl(state, redirectUri, codeChallenge);
}

// Busca por (oauth_provider, oauth_id) primero — coincide con quien ya inició
// sesión así antes. Si no existe, busca por email: alguien que ya tenía
// cuenta con contraseña propia y ahora entra por primera vez con OAuth queda
// vinculado a la misma cuenta en vez de crear un duplicado. Solo si ninguna
// de las dos coincide se crea un usuario nuevo.
async function findOrCreateUser(providerId, profile) {
  const byOAuth = await query(
    `SELECT id, nombre, email, rol, activo, institucion, avatar_url, perfil_completo
     FROM usuarios WHERE oauth_provider = $1 AND oauth_id = $2`,
    [providerId, profile.providerId],
  );
  if (byOAuth.rows[0]) return { user: byOAuth.rows[0], isNewAccount: false };

  const byEmail = await query(
    `SELECT id, nombre, email, rol, activo, institucion, avatar_url, perfil_completo
     FROM usuarios WHERE email = $1`,
    [profile.email.toLowerCase()],
  );
  if (byEmail.rows[0]) {
    await query(
      `UPDATE usuarios SET oauth_provider = $1, oauth_id = $2, actualizado_en = NOW() WHERE id = $3`,
      [providerId, profile.providerId, byEmail.rows[0].id],
    );
    return { user: byEmail.rows[0], isNewAccount: false };
  }

  // Cuenta nueva — rol 'publico' (mismo nivel que ya está abierto al público
  // en mapas/documentos/geovisor/herramientas), activa de inmediato porque el
  // proveedor externo ya verificó el correo. perfil_completo=false porque no
  // hay institución todavía — dispara la alerta de completar perfil.
  const { rows } = await query(
    `INSERT INTO usuarios
       (nombre, email, password_hash, rol, activo, email_verified,
        oauth_provider, oauth_id, avatar_url, perfil_completo)
     VALUES ($1, $2, NULL, 'publico', true, true, $3, $4, $5, false)
     RETURNING id, nombre, email, rol, activo, institucion, avatar_url, perfil_completo`,
    [profile.nombre, profile.email.toLowerCase(), providerId, profile.providerId, profile.avatarUrl],
  );
  return { user: rows[0], isNewAccount: true };
}

export async function handleCallback(providerId, code, rawState, redirectUri, { ip, userAgent } = {}) {
  const statePayload = verifyState(rawState, providerId);
  const codeVerifier = statePayload.cv ?? await consumeCodeVerifier(statePayload.nonce);
  if (!codeVerifier) {
    throw Object.assign(new Error('El enlace de inicio de sesión expiró o ya fue usado. Intenta de nuevo.'), { status: 400 });
  }

  const provider = getProvider(providerId);
  const profile = await provider.exchangeCodeForProfile(code, redirectUri, codeVerifier);

  if (!profile.email) {
    throw Object.assign(new Error(`${provider.name} no compartió un correo electrónico. No es posible continuar.`), { status: 400 });
  }
  if (!profile.emailVerified) {
    throw Object.assign(new Error(`El correo de tu cuenta de ${provider.name} no está verificado.`), { status: 400 });
  }

  const { user, isNewAccount } = await findOrCreateUser(providerId, profile);

  if (!user.activo) {
    throw Object.assign(
      new Error('Tu cuenta está pendiente de aprobación. Recibirás un correo cuando sea activada.'),
      { status: 403, code: 'ACCOUNT_INACTIVE' },
    );
  }

  const { accessToken, refreshToken } = await issueTokenPair(
    { id: user.id, email: user.email, rol: user.rol },
    { ip, userAgent },
  );

  registrarAuditoria({
    accion: isNewAccount ? 'oauth_registro' : 'oauth_login',
    modulo: 'auth',
    entidadId: user.id,
    descripcion: `${isNewAccount ? 'Cuenta creada' : 'Login'} vía ${provider.name} — ${user.email}`,
    usuarioId: user.id,
    usuarioEmail: user.email,
    ip,
    userAgent,
  });

  return {
    accessToken,
    refreshToken,
    perfilCompleto: user.perfil_completo,
    user: {
      id: user.id, nombre: user.nombre, email: user.email, rol: user.rol,
      institucion: user.institucion, avatar_url: user.avatar_url,
    },
  };
}
