-- 020: Registro de último acceso por usuario
-- Permite detectar cuentas inactivas y auditar patrones de acceso.

ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS last_login_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_usuarios_last_login
  ON usuarios (last_login_at)
  WHERE last_login_at IS NOT NULL;

COMMENT ON COLUMN usuarios.last_login_at IS
  'Timestamp del último login exitoso. NULL si el usuario nunca ha iniciado sesión.';
