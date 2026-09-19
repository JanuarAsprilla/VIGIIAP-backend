/**
 * VIGIIAP — Monitor de tráfico en memoria
 * Contadores simples de peticiones totales y bloqueadas por el rate limiter
 * general, usados por rateLimitAutoScaler.js para decidir si el tráfico
 * legítimo está creciendo lo suficiente como para subir el límite.
 * Se reinician en cada snapshot -- cada ventana se evalúa de forma
 * independiente, no acumulativa.
 */
let totalRequests = 0;
let blockedRequests = 0;

export function recordRequest() {
  totalRequests++;
}

export function recordBlocked() {
  blockedRequests++;
}

/** Devuelve los contadores de la ventana actual y los reinicia. */
export function snapshotAndReset() {
  const snapshot = { totalRequests, blockedRequests };
  totalRequests = 0;
  blockedRequests = 0;
  return snapshot;
}
