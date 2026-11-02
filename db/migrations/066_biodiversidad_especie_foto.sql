-- ─────────────────────────────────────────────────────────────────────────────
-- VIGIIAP — Biodiversidad: foto representativa por especie (grupos agregados)
-- ─────────────────────────────────────────────────────────────────────────────
-- Aves, insectos y plantas se publican como inventario agregado (sin registros individuales), así que
-- no tienen fotos propias. `especie_foto` guarda UNA fotografía representativa por especie, elegida
-- fuera de la API por un proceso aislado (scripts/biodiversidad/buscar_fotos_especies.mjs) y cargada
-- con scripts/biodiversidad/cargar_fotos_especies.js. La API solo lee esta tabla: nunca consulta GBIF.
--
-- Solo agrega una tabla; no altera ni borra datos. Reversión: db/rollback/066_biodiversidad_especie_foto.down.sql.
-- Seguridad (mismo criterio que 062/064): RLS activo, sin acceso para PUBLIC/anon/authenticated y el rol
-- `biodiversidad_ingesta` es el único que escribe. La foto es una referencia a la caché de imágenes de GBIF
-- (nunca la URL original del autor) y cita su fuente por https; los CHECK lo imponen y la API lo vuelve a validar.
-- No contiene coordenadas. La migración es idempotente.

CREATE TABLE IF NOT EXISTS biodiversidad.especie_foto (
  especie_clave TEXT PRIMARY KEY CHECK (length(especie_clave) BETWEEN 1 AND 20),
  imagen        TEXT NOT NULL CHECK (imagen ~ '^https://api\.gbif\.org/v1/image/cache/[0-9]+x/occurrence/[0-9]+/media/[a-f0-9]{32}$'),
  autor         TEXT CHECK (autor IS NULL OR length(autor) <= 300),
  editor        TEXT CHECK (editor IS NULL OR length(editor) <= 300),
  licencia      TEXT CHECK (licencia IS NULL OR length(licencia) <= 300),
  referencia    TEXT NOT NULL CHECK (referencia ~ '^https://' AND length(referencia) <= 500),
  actualizado   TIMESTAMPTZ NOT NULL DEFAULT now()
);

REVOKE ALL ON biodiversidad.especie_foto FROM PUBLIC;

DO $$
DECLARE
  rol TEXT;
BEGIN
  FOREACH rol IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = rol) THEN
      EXECUTE format('REVOKE ALL ON biodiversidad.especie_foto FROM %I', rol);
    END IF;
  END LOOP;

  ALTER TABLE biodiversidad.especie_foto ENABLE ROW LEVEL SECURITY;

  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'biodiversidad_ingesta') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON biodiversidad.especie_foto TO biodiversidad_ingesta;
    DROP POLICY IF EXISTS ingesta_acceso_total ON biodiversidad.especie_foto;
    CREATE POLICY ingesta_acceso_total ON biodiversidad.especie_foto TO biodiversidad_ingesta USING (true) WITH CHECK (true);
  END IF;
END $$;
