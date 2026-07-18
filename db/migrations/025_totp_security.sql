-- 025_totp_security.sql
-- Prevenir TOTP replay attacks: persistir el último contador de paso usado.
-- Un código TOTP válido de 6 dígitos tiene ventana de ±30s (window=1 → 90s total).
-- Al registrar el paso (counter = floor(epoch/30) + delta), el mismo código no puede
-- reutilizarse dentro de esa ventana aunque sea interceptado.

ALTER TABLE usuarios
  ADD COLUMN IF NOT EXISTS totp_last_counter BIGINT DEFAULT NULL;

COMMENT ON COLUMN usuarios.totp_last_counter
  IS 'Último paso TOTP usado (floor(epoch/30)+delta). Bloquea replay del mismo código.';
