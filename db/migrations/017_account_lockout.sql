-- 017: Bloqueo de cuenta por intentos fallidos de login
-- Previene brute-force por cuenta (más allá del rate limiter por IP).
-- Bloqueo automático tras 5 intentos fallidos, se libera a los 15 minutos.

ALTER TABLE usuarios
  ADD COLUMN IF NOT EXISTS intentos_fallidos  INTEGER     NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS bloqueado_hasta    TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_usuarios_bloqueado_hasta
  ON usuarios (bloqueado_hasta)
  WHERE bloqueado_hasta IS NOT NULL;
