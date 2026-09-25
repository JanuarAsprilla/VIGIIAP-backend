-- 052: Estado de seguimiento manual para el registro de errores
-- Antes de esta migración, error_log solo trackeaba ocurrencias/fechas -- no
-- había forma de que un admin dejara constancia de "ya lo estoy revisando" o
-- "esto ya se solucionó" sin que el error dejara de aparecer en la lista.

ALTER TABLE error_log
  ADD COLUMN IF NOT EXISTS estado TEXT NOT NULL DEFAULT 'pendiente'
    CHECK (estado IN ('pendiente', 'revisando', 'resuelto')),
  ADD COLUMN IF NOT EXISTS estado_actualizado_en TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS estado_actualizado_por TEXT;

CREATE INDEX IF NOT EXISTS error_log_estado_idx ON error_log (estado);

COMMENT ON COLUMN error_log.estado IS
  'Seguimiento manual del admin -- pendiente (default) / revisando / resuelto. Si un error marcado "resuelto" vuelve a ocurrir, errorTracking.js#registrarError lo regresa a "pendiente" automáticamente (la resolución evidentemente no fue efectiva).';
COMMENT ON COLUMN error_log.estado_actualizado_por IS
  'Email del admin que hizo el último cambio de estado -- igual criterio que usuario_email en audit_log, no una FK a usuarios para no romper el historial si el admin se elimina.';
