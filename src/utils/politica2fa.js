/**
 * Política «exigir 2FA a administradores» (configuracion.require2faAdmins) aplicada en el servidor.
 * El frontend ya redirige a /perfil (RequireAdmin); sin esto, quien llamara a la API con una sesión de
 * administrador sin TOTP seguía operando con solo la contraseña.
 */
import { query } from '../config/database.js';
import { getRequire2faAdmins } from '../config/dynamicConfig.js';

export const ROLES_CON_2FA_EXIGIDO = ['admin_sig', 'super_admin'];
export const CODIGO_2FA_REQUERIDO = '2FA_REQUIRED';

// Rutas que un administrador sin 2FA necesita para activarlo, ver su perfil y salir (todo el espacio /auth, que
// incluye /auth/me, /auth/2fa/*, /auth/logout y /auth/csrf-token, más su propio perfil y preferencias).
const RUTAS_EXENTAS = [
  /^\/api(\/v\d+)?\/auth(\/|$)/,
  /^\/api(\/v\d+)?\/usuarios\/me(\/|$)/,
  /^\/api(\/v\d+)?\/notificaciones\/prefs(\/|$)/,
];

// Un administrador recién enrolado no debe esperar mucho; la política en sí ya viene cacheada 5 min en dynamicConfig.
const TTL_ESTADO_MS = 30_000;
const MAX_ENTRADAS = 500;
const estados = new Map();

export function esRutaExenta2fa(req) {
  const ruta = String(req.originalUrl ?? req.url ?? '').split('?')[0];
  return RUTAS_EXENTAS.some((patron) => patron.test(ruta));
}

async function tieneTotpActivo(usuarioId) {
  const ahora = Date.now();
  const guardado = estados.get(usuarioId);
  if (guardado && ahora - guardado.en < TTL_ESTADO_MS) return guardado.activo;

  const { rows } = await query('SELECT totp_enabled FROM usuarios WHERE id = $1', [usuarioId]);
  const activo = Boolean(rows[0]?.totp_enabled);
  if (estados.size >= MAX_ENTRADAS) estados.clear();
  estados.set(usuarioId, { activo, en: ahora });
  return activo;
}

/** Llamar al activar o desactivar el 2FA para que el cambio se vea sin esperar al TTL. */
export function olvidarEstado2fa(usuarioId) {
  estados.delete(usuarioId);
}

/** true si la política está activa y esta cuenta administrativa no tiene TOTP. Apagada la política, no toca la BD. */
export async function incumplePolitica2fa(user) {
  if (!ROLES_CON_2FA_EXIGIDO.includes(user?.rol) || !user?.id) return false;
  if (!(await getRequire2faAdmins())) return false;
  return !(await tieneTotpActivo(user.id));
}
