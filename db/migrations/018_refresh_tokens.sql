-- 018: Tabla de refresh tokens para rotación segura de sesiones
-- El access token dura 15 min (corto); el refresh token dura 30 días.
-- Cada uso del refresh token emite un nuevo par y revoca el anterior (rotación).

CREATE TABLE IF NOT EXISTS refresh_tokens (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  token_hash   TEXT        NOT NULL UNIQUE,
  usuario_id   UUID        NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  expira_en    TIMESTAMPTZ NOT NULL,
  revocado     BOOLEAN     NOT NULL DEFAULT false,
  creado_en    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ip           TEXT,
  user_agent   TEXT
);

CREATE INDEX IF NOT EXISTS idx_refresh_tokens_usuario ON refresh_tokens(usuario_id);
CREATE INDEX IF NOT EXISTS idx_refresh_tokens_hash    ON refresh_tokens(token_hash);
