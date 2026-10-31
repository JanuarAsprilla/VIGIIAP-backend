-- Cola de reintentos de correo (outbox). Solo entra aquí un correo cuyo primer envío falló; al
-- enviarse o agotar los intentos se borra su cuerpo (html) para no conservar contenido personal,
-- y la fila se purga a los 14 días. Los correos con contraseñas temporales nunca se encolan.
CREATE TABLE IF NOT EXISTS correos_pendientes (
  id                 BIGSERIAL PRIMARY KEY,
  destinatario       TEXT        NOT NULL CHECK (char_length(destinatario) <= 320),
  asunto             TEXT        NOT NULL CHECK (char_length(asunto) <= 300),
  html               TEXT,
  estado             TEXT        NOT NULL DEFAULT 'pendiente' CHECK (estado IN ('pendiente', 'enviado', 'fallido')),
  intentos           INTEGER     NOT NULL DEFAULT 1 CHECK (intentos >= 1),
  proximo_intento_en TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ultimo_error       TEXT        CHECK (ultimo_error IS NULL OR char_length(ultimo_error) <= 500),
  creado_en          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  actualizado_en     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_correos_pendientes_cola  ON correos_pendientes (proximo_intento_en) WHERE estado = 'pendiente';
CREATE INDEX IF NOT EXISTS idx_correos_pendientes_creado ON correos_pendientes (creado_en);

ALTER TABLE correos_pendientes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_role full access" ON correos_pendientes
  TO service_role USING (true) WITH CHECK (true);
