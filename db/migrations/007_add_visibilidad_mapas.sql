-- 007: Agrega control de visibilidad a la tabla mapas
ALTER TABLE mapas
  ADD COLUMN IF NOT EXISTS visibilidad VARCHAR(20) NOT NULL DEFAULT 'publico'
    CHECK (visibilidad IN ('publico', 'usuarios', 'acreditados'));
