-- ============================================================
-- 014_geo_metadata_mapas.sql
-- Metadatos geoespaciales en tabla mapas
-- VIGIIAP — IIAP Colombia
-- ============================================================
-- Añade columnas ISO 19115 / IGAC a la tabla mapas:
--   epsg       → código EPSG del sistema de referencia (ej. 4686)
--   escala     → denominador de escala cartográfica (ej. 25000 para 1:25.000)
--   fuente     → institución productora del mapa
--   bbox_norte/sur/este/oeste → extensión geográfica en WGS84
-- ─────────────────────────────────────────────────────────────

ALTER TABLE mapas
  ADD COLUMN IF NOT EXISTS epsg        INTEGER,
  ADD COLUMN IF NOT EXISTS escala      INTEGER,
  ADD COLUMN IF NOT EXISTS fuente      VARCHAR(200),
  ADD COLUMN IF NOT EXISTS bbox_norte  NUMERIC(8,5),
  ADD COLUMN IF NOT EXISTS bbox_sur    NUMERIC(8,5),
  ADD COLUMN IF NOT EXISTS bbox_este   NUMERIC(9,5),
  ADD COLUMN IF NOT EXISTS bbox_oeste  NUMERIC(9,5);

CREATE INDEX IF NOT EXISTS idx_mapas_epsg   ON mapas(epsg);
CREATE INDEX IF NOT EXISTS idx_mapas_fuente ON mapas(fuente);

COMMENT ON COLUMN mapas.epsg       IS 'Código EPSG del CRS (ej. 4686 = MAGNA-SIRGAS geográfico)';
COMMENT ON COLUMN mapas.escala     IS 'Denominador de escala cartográfica (ej. 25000 para 1:25.000)';
COMMENT ON COLUMN mapas.fuente     IS 'Institución productora o responsable del dato cartográfico';
COMMENT ON COLUMN mapas.bbox_norte IS 'Latitud norte del área de cobertura (WGS84)';
COMMENT ON COLUMN mapas.bbox_sur   IS 'Latitud sur del área de cobertura (WGS84)';
COMMENT ON COLUMN mapas.bbox_este  IS 'Longitud este del área de cobertura (WGS84)';
COMMENT ON COLUMN mapas.bbox_oeste IS 'Longitud oeste del área de cobertura (WGS84)';
