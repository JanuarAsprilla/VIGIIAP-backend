/**
 * VIGIIAP — Monitor de tráfico en memoria
 * Contadores simples de peticiones totales y bloqueadas por el rate limiter
 * general, usados por rateLimitAutoScaler.js para decidir si el tráfico
 * legítimo está creciendo lo suficiente como para subir el límite.
 * Se reinician en cada snapshot -- cada ventana se evalúa de forma
 * independiente, no acumulativa.
 */
// Tope de clientes distintos que se recuerdan por ventana: acota la memoria ante un barrido de IPs.
const MAX_CLIENTES_REGISTRADOS = 1000;

let totalRequests = 0;
let blockedRequests = 0;
let clientesBloqueados = new Set();

export function recordRequest() {
  totalRequests++;
}

/** `cliente`: la clave del limitador (usuario o IP); sirve para distinguir un solo cliente insistente de tráfico real creciendo. */
export function recordBlocked(cliente) {
  blockedRequests++;
  if (cliente !== undefined && clientesBloqueados.size < MAX_CLIENTES_REGISTRADOS) clientesBloqueados.add(String(cliente));
}

/** Devuelve los contadores de la ventana actual y los reinicia. */
export function snapshotAndReset() {
  const snapshot = { totalRequests, blockedRequests, blockedClients: clientesBloqueados.size };
  totalRequests = 0;
  blockedRequests = 0;
  clientesBloqueados = new Set();
  return snapshot;
}
