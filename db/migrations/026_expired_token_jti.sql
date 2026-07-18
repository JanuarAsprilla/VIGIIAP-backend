-- 026_expired_token_jti.sql
-- Prevenir replay del token JWT temporal de contraseña expirada.
-- El jti (JWT ID) se almacena al emitir el token y se elimina al consumirlo.
-- Si el token es interceptado y reutilizado, el jti ya no coincide → 401.

ALTER TABLE usuarios
  ADD COLUMN IF NOT EXISTS expired_token_jti TEXT DEFAULT NULL;

COMMENT ON COLUMN usuarios.expired_token_jti
  IS 'JTI del token temporal de cambio de contraseña expirada. NULL = token ya consumido o no emitido.';
