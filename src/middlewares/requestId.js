import { randomUUID } from 'node:crypto';

// Solo acepta UUIDs canónicos o identificadores alfanuméricos con guiones (max 64 chars).
// Rechazar valor del cliente si no cumple — genera uno propio. Previene log injection via ANSI/CRLF.
const SAFE_ID_RE = /^[\w\-]{1,64}$/;

export function requestId(req, res, next) {
  const clientId = req.headers['x-request-id'];
  const id = (clientId && SAFE_ID_RE.test(clientId)) ? clientId : randomUUID();
  req.requestId = id;
  res.setHeader('X-Request-Id', id);
  next();
}
