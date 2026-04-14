-- ─────────────────────────────────────────────────────────────────────────────
-- VIGIIAP — Migración 004: Verificación de email y recuperación de contraseña
-- ─────────────────────────────────────────────────────────────────────────────

-- ─── Verificación de email ────────────────────────────────────────────────────
ALTER TABLE usuarios
  ADD COLUMN IF NOT EXISTS email_verified          BOOLEAN    NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS email_verification_token TEXT       UNIQUE,
  ADD COLUMN IF NOT EXISTS email_verification_expires TIMESTAMPTZ;

-- Usuarios creados por admin ya tienen email "verificado" (ellos asignan el correo)
-- Los existentes los marcamos como verificados para no bloquear cuentas activas
UPDATE usuarios SET email_verified = true WHERE activo = true;

-- ─── Recuperación de contraseña ───────────────────────────────────────────────
ALTER TABLE usuarios
  ADD COLUMN IF NOT EXISTS password_reset_token   TEXT       UNIQUE,
  ADD COLUMN IF NOT EXISTS password_reset_expires TIMESTAMPTZ;

-- ─── Índices ──────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_usuarios_verification_token
  ON usuarios(email_verification_token)
  WHERE email_verification_token IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_usuarios_reset_token
  ON usuarios(password_reset_token)
  WHERE password_reset_token IS NOT NULL;
