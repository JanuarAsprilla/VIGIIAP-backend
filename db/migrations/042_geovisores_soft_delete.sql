-- 042: Soft delete para geovisores
-- Mismo criterio que 021_soft_deletes.sql (mapas/documentos/noticias/categorías):
-- IIAP es entidad del Estado colombiano — los datos geoespaciales no se destruyen
-- permanentemente. geovisores quedó fuera de esa migración porque la tabla no
-- existía todavía (creada en 037_geovisores.sql) y nunca se le agregó después,
-- así que hasta ahora se eliminaba con un DELETE físico sin red de seguridad.

ALTER TABLE geovisores ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_geovisores_active ON geovisores (id) WHERE deleted_at IS NULL;

COMMENT ON COLUMN geovisores.deleted_at IS 'Soft delete — NULL = activo, NOT NULL = en papelera';
