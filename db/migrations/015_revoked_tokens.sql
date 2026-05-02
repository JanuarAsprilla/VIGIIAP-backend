-- ============================================================
-- 015_revoked_tokens.sql
-- Blacklist de tokens JWT revocados (logout + invalidación forzada)
-- VIGIIAP — IIAP Colombia
-- ============================================================
-- La verificación usa la tabla en memoria (cargada al arrancar).
-- Esta tabla persiste entre reinicios y permite limpiar tokens
-- expirados automáticamente.
-- ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS revoked_tokens (
  token_hash  CHAR(64)    PRIMARY KEY,  -- SHA-256 del token JWT
  expires_at  TIMESTAMPTZ NOT NULL,
  revoked_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS rt_expires_at ON revoked_tokens(expires_at);

COMMENT ON TABLE revoked_tokens IS
  'Tokens JWT invalidados antes de su expiración natural. '
  'La carga inicial en memoria evita un hit de BD por cada request autenticado.';
