import { query } from '../config/database.js';
import { registrarAuditoria } from './auditLog.js';
import { ubicarIp } from './geolocalizacion.js';
import { notifyAlertaSeguridad } from './mailer.js';
import logger from './logger.js';

/**
 * Alertas de seguridad que se deducen del tráfico de login:
 *  - ráfaga de intentos fallidos desde una misma IP (fuerza bruta o relleno de credenciales);
 *  - inicio de sesión de un administrador desde una ubicación que no había usado antes.
 * Cada alerta deja un evento en la auditoría y avisa por correo. Nunca interrumpe el login.
 */
const UMBRAL_FALLOS = 10;
const VENTANA_MS = 10 * 60 * 1000;
const ENFRIAMIENTO_MS = 60 * 60 * 1000;
const MAX_IPS_SEGUIDAS = 5_000;
const ROLES_VIGILADOS = ['admin_sig', 'super_admin'];
const DIAS_HISTORIAL = 90;
const MAX_IPS_HISTORIAL = 50;

const fallosPorIp = new Map();
const ultimaAlertaPorIp = new Map();

function podar(mapa, ahora, vigenciaMs) {
  for (const [clave, marca] of mapa) {
    const ultima = Array.isArray(marca) ? marca[marca.length - 1] : marca;
    if (ahora - ultima >= vigenciaMs) mapa.delete(clave);
  }
  if (mapa.size >= MAX_IPS_SEGUIDAS) mapa.clear();
}

async function destinatariosAdministradores() {
  // Import diferido: admin.service importa auth.service, que usa este módulo.
  const { getAdminEmails } = await import('../modules/admin/admin.service.js');
  return getAdminEmails();
}

async function avisar(correos, alerta) {
  await Promise.all(correos.map((email) =>
    notifyAlertaSeguridad({ email, ...alerta }).catch((err) =>
      logger.warn(`[alertasSeguridad] No se pudo avisar a ${email}: ${err.message}`))));
}

async function alertarRafaga(ip, intentos) {
  const descripcion = `${intentos} intentos de login fallidos desde ${ip} en ${VENTANA_MS / 60_000} minutos`;
  registrarAuditoria({ accion: 'alerta_rafaga_login', modulo: 'seguridad', resultado: 'denegado', descripcion, ip });
  const correos = await destinatariosAdministradores();
  await avisar(correos, {
    titulo: 'Ráfaga de intentos de login fallidos',
    mensaje: 'Se detectó un número inusual de intentos fallidos de inicio de sesión desde una misma dirección.',
    detalles: [['Dirección IP', ip], ['Intentos', `${intentos} en ${VENTANA_MS / 60_000} minutos`]],
    ctaPath: '/admin/actividad',
    ctaLabel: 'Ver la actividad',
  });
}

/** Cuenta un intento fallido; al llegar al umbral dentro de la ventana lanza la alerta (una por hora y por IP). */
export function registrarFalloLogin(ip, ahora = Date.now()) {
  if (!ip) return;
  const recientes = (fallosPorIp.get(ip) ?? []).filter((marca) => ahora - marca < VENTANA_MS);
  recientes.push(ahora);
  if (fallosPorIp.size >= MAX_IPS_SEGUIDAS) podar(fallosPorIp, ahora, VENTANA_MS);
  fallosPorIp.set(ip, recientes);

  if (recientes.length < UMBRAL_FALLOS) return;
  const ultima = ultimaAlertaPorIp.get(ip);
  if (ultima !== undefined && ahora - ultima < ENFRIAMIENTO_MS) return;
  if (ultimaAlertaPorIp.size >= MAX_IPS_SEGUIDAS) podar(ultimaAlertaPorIp, ahora, ENFRIAMIENTO_MS);
  ultimaAlertaPorIp.set(ip, ahora);
  alertarRafaga(ip, recientes.length).catch((err) => logger.warn(`[alertasSeguridad] Error en la alerta de ráfaga: ${err.message}`));
}

function mismoLugar(a, b) {
  return a.pais === b.pais && (a.departamento ?? null) === (b.departamento ?? null);
}

function describirLugar(ubicacion) {
  return [ubicacion.ciudad, ubicacion.departamento, ubicacion.pais].filter(Boolean).join(', ');
}

/**
 * Avisa si un administrador inicia sesión desde un lugar (país + departamento) distinto de todos
 * los de sus inicios de sesión de los últimos 90 días. Sin historial previo no hay referencia
 * y no alerta. Conviene llamarla ANTES de registrar el login actual.
 */
export async function evaluarUbicacionNueva(usuario, ip) {
  try {
    if (!ROLES_VIGILADOS.includes(usuario?.rol) || !ip) return;
    const actual = ubicarIp(ip);
    if (!actual) return;

    const { rows } = await query(
      `SELECT DISTINCT ip FROM audit_log
       WHERE accion = 'login' AND usuario_id = $1 AND ip IS NOT NULL
         AND creado_en > NOW() - make_interval(days => $2)
       LIMIT $3`,
      [usuario.id, DIAS_HISTORIAL, MAX_IPS_HISTORIAL],
    );
    if (rows.length === 0) return;
    if (rows.some((fila) => fila.ip === ip)) return;
    const conocido = rows.some((fila) => {
      const previa = ubicarIp(fila.ip);
      return previa && mismoLugar(previa, actual);
    });
    if (conocido) return;

    const lugar = describirLugar(actual);
    registrarAuditoria({
      accion: 'login_ubicacion_nueva', modulo: 'seguridad',
      descripcion: `Inicio de sesión de ${usuario.email} desde una ubicación nueva: ${lugar}`,
      usuarioId: usuario.id, usuarioEmail: usuario.email, ip,
    });
    await avisar([usuario.email], {
      titulo: 'Inicio de sesión desde una ubicación nueva',
      mensaje: 'Acabas de iniciar sesión en VIGIIAP desde un lugar que no habías usado en los últimos 90 días.',
      detalles: [['Ubicación aproximada', lugar], ['Dirección IP', ip]],
      ctaPath: '/perfil',
      ctaLabel: 'Revisar mi cuenta',
    });
  } catch (err) {
    logger.warn(`[alertasSeguridad] Error evaluando la ubicación del login: ${err.message}`);
  }
}

/** Solo para pruebas. */
export function reiniciarAlertasSeguridad() {
  fallosPorIp.clear();
  ultimaAlertaPorIp.clear();
}
