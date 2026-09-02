-- 035: Registro propio de errores 5xx
-- Sustituye la dependencia de Sentry (SENTRY_DSN es una variable opcional que
-- puede no estar configurada en el dashboard de Render) por un registro
-- mínimo, autohospedado: agrupa errores repetidos por fingerprint en vez de
-- insertar una fila por cada ocurrencia, para que un error caliente no inunde
-- la tabla ni el buzón de los admins.

CREATE TABLE IF NOT EXISTS error_log (
  id            SERIAL PRIMARY KEY,
  fingerprint   TEXT NOT NULL,
  mensaje       TEXT NOT NULL,
  stack         TEXT,
  metodo        TEXT,
  ruta          TEXT,
  status_code   INTEGER,
  ocurrencias   INTEGER NOT NULL DEFAULT 1,
  primera_vez   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ultima_vez    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  notificado_en TIMESTAMPTZ
);

CREATE UNIQUE INDEX IF NOT EXISTS error_log_fingerprint_idx ON error_log (fingerprint);
CREATE INDEX IF NOT EXISTS error_log_ultima_vez_idx ON error_log (ultima_vez DESC);

-- Mismo patrón que 030_rls_missing_tables.sql — la API conecta como "postgres"
-- y bypassa RLS, esto solo bloquea el acceso público vía PostgREST de Supabase.
ALTER TABLE error_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role full access" ON error_log
  TO service_role USING (true) WITH CHECK (true);

COMMENT ON COLUMN error_log.fingerprint IS
  'Hash de método+ruta+mensaje — agrupa ocurrencias del mismo error en una sola fila.';
COMMENT ON COLUMN error_log.notificado_en IS
  'Última vez que se alertó a los admins por email sobre este fingerprint (cooldown en errorTracking.js).';
