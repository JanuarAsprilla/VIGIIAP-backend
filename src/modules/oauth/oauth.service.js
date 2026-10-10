import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { query } from '../../config/database.js';
import { getProvider, PROVIDERS } from './oauth.providers.js';
import { issueTokenPair, generateSecureToken, hashToken } from '../auth/auth.service.js';
import { registrarAuditoria } from '../../utils/auditLog.js';
import { getRedisClient } from '../../middlewares/cache.js';
import logger from '../../utils/logger.js';

// El "state" del flujo OAuth viaja como JWT de vida corta en vez de guardarse
// en BD — no hay estado de sesión previo al callback (el navegador va y
// vuelve del proveedor externo), así que firmar el proveedor+nonce y
// verificarlo al volver basta para el CSRF de FORJA de state sin
// infraestructura extra. Eso NO cubre login-CSRF (ver `csrfCookie` abajo):
// un state válidamente firmado para la cuenta del ATACANTE, completado por
// el atacante mismo y luego entregado a la víctima, pasaba esta verificación
// igual — por eso el state también lleva el hash de una cookie httpOnly que
// solo existe en el navegador que inició el flujo.
function signState(providerId, nonce, csrfCookieHash) {
  return jwt.sign({ provider: providerId, nonce, csrf: csrfCookieHash }, process.env.JWT_SECRET, { expiresIn: '10m' });
}

function hashCsrfCookie(valor) {
  return crypto.createHash('sha256').update(valor).digest('hex');
}

function verifyState(rawState, expectedProvider, csrfCookieValor) {
  let payload;
  try {
    payload = jwt.verify(rawState, process.env.JWT_SECRET);
  } catch {
    throw Object.assign(new Error('El enlace de inicio de sesión expiró o no es válido. Intenta de nuevo.'), { status: 400 });
  }
  if (payload.provider !== expectedProvider) {
    throw Object.assign(new Error('El enlace de inicio de sesión no corresponde a este proveedor.'), { status: 400 });
  }
  // Login-CSRF: el state debe estar atado al navegador que inició el flujo.
  // Sin csrfCookieValor (cookie ausente/expirada) o sin que coincida con el
  // hash firmado en el state, este NO es el navegador que llamó a /start —
  // podría ser un state legítimo del atacante, replicado en la víctima.
  const hashEsperado = csrfCookieValor ? hashCsrfCookie(csrfCookieValor) : null;
  if (!hashEsperado || hashEsperado !== payload.csrf) {
    throw Object.assign(
      new Error('No se pudo verificar el inicio de sesión en este navegador. Intenta de nuevo desde el botón de inicio de sesión.'),
      { status: 400, code: 'OAUTH_CSRF_MISMATCH' },
    );
  }
  return payload;
}

// ─── PKCE (RFC 7636) ─────────────────────────────────────────────────────
// Capa extra sobre el client_secret que ya usa este flujo (cliente
// confidencial) — protege también si el `code` queda expuesto en un canal
// intermedio (proxy, CDN, historial del navegador) antes de que este backend
// lo canjee. El code_verifier se guarda server-side en Redis, atado al mismo
// nonce que ya viaja en el state. Si Redis no está disponible, el fallback
// es una cookie httpOnly propia (vigiiap_oauth_cv, ver oauth.controller.js)
// -- NUNCA el propio state/URL, que es exactamente el canal que PKCE existe
// para proteger si queda expuesto (logs, Referer, historial).
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

export async function buildAuthorizationUrl(providerId, redirectUri, csrfCookieValor) {
  const provider = getProvider(providerId);
  if (!provider.isConfigured()) {
    throw Object.assign(new Error(`El inicio de sesión con ${provider.name} todavía no está disponible.`), { status: 501 });
  }
  const nonce = crypto.randomBytes(16).toString('hex');
  const { codeVerifier, codeChallenge } = generatePkce();
  const storedInRedis = await storeCodeVerifier(nonce, codeVerifier);
  const state = signState(providerId, nonce, hashCsrfCookie(csrfCookieValor));
  const url = provider.getAuthorizationUrl(state, redirectUri, codeChallenge);
  // El controlador pone esto en una cookie httpOnly SOLO cuando Redis no
  // guardó el verifier -- si pudo guardarlo, no hay nada que exponer aquí.
  return { url, codeVerifierCookie: storedInRedis ? null : codeVerifier };
}

// Busca por (oauth_provider, oauth_id) primero — coincide con quien ya inició
// sesión así antes. Si no existe, busca por email: alguien que ya tenía
// cuenta con contraseña propia y ahora entra por primera vez con OAuth queda
// vinculado a la misma cuenta en vez de crear un duplicado. Solo si ninguna
// de las dos coincide se crea un usuario nuevo.
async function findOrCreateUser(providerId, profile, { ip, userAgent } = {}) {
  const byOAuth = await query(
    `SELECT id, nombre, email, rol, activo, email_verified, institucion, avatar_url, perfil_completo, totp_enabled
     FROM usuarios WHERE oauth_provider = $1 AND oauth_id = $2`,
    [providerId, profile.providerId],
  );
  if (byOAuth.rows[0]) return { user: byOAuth.rows[0], isNewAccount: false };

  const byEmail = await query(
    `SELECT id, nombre, email, rol, activo, email_verified, institucion, avatar_url, perfil_completo, totp_enabled, password_hash, oauth_provider
     FROM usuarios WHERE email = $1`,
    [profile.email.toLowerCase()],
  );
  if (byEmail.rows[0]) {
    const existing = byEmail.rows[0];

    if (existing.email_verified) {
      // Mismo problema de fondo (clase "nOAuth") sin contraseña de por
      // medio: si esta cuenta YA VERIFICADA quedó vinculada a OTRO
      // proveedor, un segundo proveedor que afirme el mismo correo (p.ej.
      // editando el atributo mail de un tenant Entra ID propio, sin que eso
      // pruebe nada) no debe poder re-vincularla en silencio — sería tan
      // grave como el caso con contraseña, solo que la cuenta nació por
      // OAuth en vez de con clave. Estas dos protecciones solo aplican
      // aquí, sobre una cuenta cuyo correo ya probó tener dueño real — ver
      // la rama de abajo para el caso sin verificar.
      if (existing.oauth_provider && existing.oauth_provider !== providerId) {
        throw Object.assign(
          new Error('Ya existe una cuenta con este correo vinculada a otro proveedor. Inicia sesión con ese método.'),
          { status: 409, code: 'EMAIL_LINKED_TO_OTHER_PROVIDER' },
        );
      }
      if (existing.password_hash) {
        // Nunca vincular en silencio una identidad externa a una cuenta que
        // ya tiene contraseña propia solo porque el correo coincide — el
        // proveedor OAuth es quien afirma esa dirección, no quien prueba ser
        // dueño de la cuenta local. Vincular requiere que el usuario entre
        // primero con su contraseña (fuera del alcance de este endpoint).
        throw Object.assign(
          new Error('Ya existe una cuenta con este correo. Inicia sesión con tu contraseña.'),
          { status: 409, code: 'EMAIL_LINKED_TO_PASSWORD_ACCOUNT' },
        );
      }
      await query(
        `UPDATE usuarios SET oauth_provider = $1, oauth_id = $2, actualizado_en = NOW() WHERE id = $3`,
        [providerId, profile.providerId, existing.id],
      );
      return { user: existing, isNewAccount: false };
    }

    // REGRESIÓN (pre-hijacking / backdoor de verificación): esta fila existe
    // pero su correo NUNCA quedó verificado — ni por una contraseña que
    // nadie llegó a confirmar, ni por un proveedor OAuth distinto cuyo
    // intento anterior tampoco se verificó. Ese reclamo previo no prueba
    // nada (ver findOrCreateUser más abajo sobre por qué el claim de un
    // proveedor no basta), así que bloquearlo aquí como arriba tendría DOS
    // problemas: (1) permite que cualquiera "reserve" el correo de otra
    // persona y se lo niegue PARA SIEMPRE a su dueño real (ni por OAuth ni
    // por registro con contraseña, que también choca con este mismo correo)
    // — clase DoS de pre-hijacking; (2) si en vez de bloquear se vinculara
    // oauth_provider/oauth_id SIN limpiar el reclamo anterior, el día que el
    // dueño real verifique este correo por CUALQUIER camino (p.ej.
    // reenviarVerificacion), el proveedor/identidad que quedó vinculado
    // primero —el del atacante— seguiría siendo una puerta de entrada
    // válida y permanente a la cuenta que el dueño real acaba de reclamar:
    // byOAuth() del próximo login del atacante la encontraría igual, y para
    // entonces ya pasaría el chequeo de email_verified. Por eso esta fila se
    // "reescribe" para el intento ACTUAL — que sí pasó la verificación
    // propia de su proveedor (profile.emailVerified, más arriba): se limpia
    // cualquier password_hash o vínculo OAuth anterior sin verificar y se
    // emite un token de verificación nuevo; el anterior (de haber alguno)
    // deja de servir porque ya no coincide con el hash que queda guardado.
    const verificationToken = generateSecureToken();
    const verificationExpires = new Date(Date.now() + 24 * 60 * 60 * 1000);
    // AND email_verified = false: cierra la carrera contra una verificación
    // concurrente de ESTA MISMA fila (otra petición) entre el SELECT de
    // arriba y este UPDATE -- sin esto, pisaríamos una cuenta que alguien
    // acaba de confirmar justo en ese instante.
    const { rows: reclamada } = await query(
      `UPDATE usuarios SET
         oauth_provider = $1, oauth_id = $2, password_hash = NULL,
         email_verification_token = $3, email_verification_expires = $4,
         actualizado_en = NOW()
       WHERE id = $5 AND email_verified = false
       RETURNING id, nombre, email, rol, activo, institucion, avatar_url, perfil_completo, email_verified`,
      [providerId, profile.providerId, hashToken(verificationToken), verificationExpires, existing.id],
    );
    if (!reclamada[0]) {
      throw Object.assign(
        new Error('Alguien acaba de verificar este correo. Intenta iniciar sesión de nuevo.'),
        { status: 409, code: 'EMAIL_VERIFIED_CONCURRENTLY' },
      );
    }
    registrarAuditoria({
      accion: 'oauth_reclamo_correo_sin_verificar',
      modulo: 'auth',
      entidadId: existing.id,
      descripcion: `Reclamo de correo sin verificar vía ${providerId} — ${existing.email} (reemplaza un reclamo previo que tampoco se verificó)`,
      usuarioId: existing.id,
      usuarioEmail: existing.email,
      ip,
      userAgent,
    });
    return { user: reclamada[0], isNewAccount: true, verificationToken };
  }

  // Cuenta nueva — rol 'publico' (mismo nivel que ya está abierto al público
  // en mapas/documentos/geovisor/herramientas), activa de inmediato (igual
  // que antes) pero SIN dar por verificado el correo que solo afirma el
  // proveedor — Microsoft mismo documenta que ese claim no está verificado y
  // no debe usarse para decisiones de autorización. Cierra aquí la clase
  // nOAuth que antes quedaba como residual: si nadie tenía ya esta cuenta,
  // exigir la misma confirmación por correo que usa el registro con
  // contraseña (generateSecureToken/hashToken + verifyEmail, ver
  // auth.service.js) es lo único que prueba que quien hizo el login es
  // dueño real del correo, no solo alguien a quien el proveedor se lo
  // afirmó (p.ej. editando el atributo mail de un tenant Entra ID propio).
  // perfil_completo=false porque no hay institución todavía — la alerta de
  // completar perfil solo aplica una vez que el correo quede verificado,
  // ya que handleCallback bloquea el login hasta entonces.
  const verificationToken = generateSecureToken();
  const verificationExpires = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24h, igual que register()
  const { rows } = await query(
    `INSERT INTO usuarios
       (nombre, email, password_hash, rol, activo, email_verified,
        email_verification_token, email_verification_expires,
        oauth_provider, oauth_id, avatar_url, perfil_completo)
     VALUES ($1, $2, NULL, 'publico', true, false, $3, $4, $5, $6, $7, false)
     RETURNING id, nombre, email, rol, activo, institucion, avatar_url, perfil_completo, email_verified`,
    [
      profile.nombre, profile.email.toLowerCase(),
      hashToken(verificationToken), verificationExpires,
      providerId, profile.providerId, profile.avatarUrl,
    ],
  );
  registrarAuditoria({
    accion: 'oauth_registro',
    modulo: 'auth',
    entidadId: rows[0].id,
    descripcion: `Cuenta creada vía ${providerId} — ${rows[0].email} (pendiente de verificar correo)`,
    usuarioId: rows[0].id,
    usuarioEmail: rows[0].email,
    ip,
    userAgent,
  });
  return { user: rows[0], isNewAccount: true, verificationToken };
}

export async function handleCallback(providerId, code, rawState, redirectUri, { ip, userAgent, csrfCookieValor, codeVerifierCookie } = {}) {
  const statePayload = verifyState(rawState, providerId, csrfCookieValor);
  const codeVerifier = codeVerifierCookie ?? await consumeCodeVerifier(statePayload.nonce);
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

  const { user, isNewAccount, verificationToken } = await findOrCreateUser(providerId, profile, { ip, userAgent });

  // Mismo orden que login() con contraseña (ver auth.service.js#login): el
  // correo sin verificar bloquea ANTES de mirar `activo` — ver residual
  // nOAuth documentado en findOrCreateUser(). Una cuenta recién creada
  // necesita que el controlador envíe el correo con `verificationToken`
  // (nunca se guarda en claro, solo existe en este valor de retorno); una ya
  // existente que sigue sin verificar (reintento con un enlace vencido o sin
  // usar) ya recibió ese correo antes, así que solo se bloquea — puede pedir
  // uno nuevo con el mismo POST /api/auth/reenviar-verificacion que usa el
  // registro con contraseña.
  if (!user.email_verified) {
    if (isNewAccount) {
      return {
        requiresEmailVerification: true,
        isNewAccount: true,
        email: user.email,
        nombre: user.nombre,
        verificationToken,
      };
    }
    throw Object.assign(
      new Error('Debes verificar tu correo antes de ingresar. Revisa el enlace que te enviamos o solicita uno nuevo.'),
      { status: 403, code: 'EMAIL_NOT_VERIFIED' },
    );
  }

  if (!user.activo) {
    throw Object.assign(
      new Error('Tu cuenta está pendiente de aprobación. Recibirás un correo cuando sea activada.'),
      { status: 403, code: 'ACCOUNT_INACTIVE' },
    );
  }

  // El login con contraseña exige el segundo factor antes de emitir sesión
  // (ver auth.service.js#login) — OAuth no puede saltarse esa misma puerta
  // solo por entrar con otro método; el token de scope 'access' nunca debe
  // emitirse para una cuenta con 2FA activo sin haberlo completado.
  if (user.totp_enabled) {
    const twoFactorToken = jwt.sign(
      { id: user.id, email: user.email, rol: user.rol, scope: '2fa' },
      process.env.JWT_SECRET,
      { expiresIn: '15m', algorithm: 'HS256' },
    );
    return { requiresTwoFactor: true, twoFactorToken };
  }

  const { accessToken, refreshToken } = await issueTokenPair(
    { id: user.id, email: user.email, rol: user.rol },
    { ip, userAgent },
  );

  // isNewAccount ya no llega aquí en true: toda cuenta nueva retorna antes
  // (requiresEmailVerification) o lanza EMAIL_NOT_VERIFIED en el chequeo de
  // arriba — el alta en sí ya quedó auditada como 'oauth_registro' dentro de
  // findOrCreateUser() al crearse.
  registrarAuditoria({
    accion: 'oauth_login',
    modulo: 'auth',
    entidadId: user.id,
    descripcion: `Login vía ${provider.name} — ${user.email}`,
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
