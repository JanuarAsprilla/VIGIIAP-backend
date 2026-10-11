import { registrarAuditoria } from './auditLog.js';

// Quien insiste sobre la misma ruta genera un solo evento por ventana, para no inundar el
// registro (un bucle de peticiones prohibidas llenaría la tabla en minutos).
const VENTANA_MS = 60_000;
const MAX_CLAVES = 5_000;
const vistos = new Map();

function purgar(ahora) {
  for (const [clave, marca] of vistos) {
    if (ahora - marca >= VENTANA_MS) vistos.delete(clave);
  }
  // Si aun así está lleno (muchas claves distintas en la misma ventana), se reinicia: la memoria
  // acotada importa más que no repetir un evento.
  if (vistos.size >= MAX_CLAVES) vistos.clear();
}

/** Deja constancia de un intento de acceso sin permiso. `motivo` explica qué faltaba. */
export function registrarAccesoDenegado(req, motivo) {
  const ruta = String(req.originalUrl ?? req.url ?? '').split('?')[0].slice(0, 200);
  const clave = `${req.user?.id ?? req.ip}|${req.method}|${ruta}`;
  const ahora = Date.now();

  const previo = vistos.get(clave);
  if (previo !== undefined && ahora - previo < VENTANA_MS) return;
  if (vistos.size >= MAX_CLAVES) purgar(ahora);
  vistos.set(clave, ahora);

  registrarAuditoria({
    accion: 'acceso_denegado',
    modulo: 'seguridad',
    resultado: 'denegado',
    descripcion: `Acceso denegado: ${req.method} ${ruta} — ${motivo}`,
    usuarioId: req.user?.id ?? null,
    usuarioEmail: req.user?.email ?? null,
    ip: req.ip,
    userAgent: req.headers?.['user-agent'] ?? null,
  });
}

/** Solo para pruebas. */
export function reiniciarAccesosDenegados() {
  vistos.clear();
}
