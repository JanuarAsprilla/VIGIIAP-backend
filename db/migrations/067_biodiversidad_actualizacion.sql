-- ─────────────────────────────────────────────────────────────────────────────
-- VIGIIAP — Biodiversidad: configuración y bitácora de la actualización automática
-- ─────────────────────────────────────────────────────────────────────────────
-- El super administrador decide cómo se mantienen al día los datos de biodiversidad:
--   · modo «publico»: sin cuenta de GBIF (revisión de frescura con la API pública y fotos por especie).
--   · modo «cuenta»: con una cuenta de GBIF de la persona designada (descargas completas, cuando exista el proceso).
-- La persona designada es cualquier administrador con el módulo `biodiversidad_datos` (permisos por módulo
-- existentes). La clave de GBIF se guarda cifrada (AES-256-GCM, BIODIVERSIDAD_ENCRYPTION_KEY) y no sale nunca por la API.
-- Solo agrega tablas; no altera datos. Reversión: db/rollback/067_biodiversidad_actualizacion.down.sql. Idempotente.

CREATE TABLE IF NOT EXISTS bio_actualizacion_ajustes (
  id                    SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  modo                  TEXT NOT NULL DEFAULT 'publico' CHECK (modo IN ('publico', 'cuenta')),
  activa                BOOLEAN NOT NULL DEFAULT true,
  frecuencia_dias       SMALLINT NOT NULL DEFAULT 30 CHECK (frecuencia_dias BETWEEN 7 AND 90),
  -- Quién aporta la cuenta de GBIF para las ejecuciones automáticas del modo «cuenta».
  credencial_usuario_id UUID REFERENCES usuarios(id) ON DELETE SET NULL,
  actualizado_por       UUID REFERENCES usuarios(id) ON DELETE SET NULL,
  actualizado_en        TIMESTAMPTZ NOT NULL DEFAULT now()
);
INSERT INTO bio_actualizacion_ajustes (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS bio_actualizacion_credenciales (
  usuario_id     UUID PRIMARY KEY REFERENCES usuarios(id) ON DELETE CASCADE,
  gbif_usuario   TEXT NOT NULL CHECK (length(gbif_usuario) BETWEEN 3 AND 100),
  gbif_correo    TEXT NOT NULL CHECK (length(gbif_correo) BETWEEN 5 AND 200),
  clave_cifrada  TEXT NOT NULL,
  actualizado_en TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS bio_actualizacion_ejecuciones (
  id             BIGSERIAL PRIMARY KEY,
  tarea          TEXT NOT NULL CHECK (tarea IN ('fotos', 'frescura', 'datos')),
  disparador     TEXT NOT NULL CHECK (disparador IN ('programada', 'manual')),
  solicitado_por UUID REFERENCES usuarios(id) ON DELETE SET NULL,
  estado         TEXT NOT NULL DEFAULT 'solicitada' CHECK (estado IN ('solicitada', 'en_curso', 'ok', 'error', 'omitida')),
  resumen        JSONB NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(resumen) = 'object'),
  creado_en      TIMESTAMPTZ NOT NULL DEFAULT now(),
  inicio         TIMESTAMPTZ,
  fin            TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_bio_actualizacion_ejecuciones_tarea ON bio_actualizacion_ejecuciones (tarea, creado_en DESC);
-- Una sola solicitud o ejecución en curso por tarea: evita que se amontonen y que se pisen.
CREATE UNIQUE INDEX IF NOT EXISTS uq_bio_actualizacion_pendiente ON bio_actualizacion_ejecuciones (tarea)
  WHERE estado IN ('solicitada', 'en_curso');
