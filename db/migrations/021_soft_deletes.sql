-- 021: Soft deletes para entidades principales
-- IIAP es entidad del Estado colombiano — los datos ambientales no se destruyen permanentemente.
-- Destruir un mapa geoespacial o documento ambiental puede tener implicaciones legales y de auditoría.

ALTER TABLE mapas      ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
ALTER TABLE documentos ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
ALTER TABLE noticias   ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
ALTER TABLE categorias ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

-- Partial indexes: el planificador usa estos en WHERE deleted_at IS NULL sin costo en writes normales
CREATE INDEX IF NOT EXISTS idx_mapas_active       ON mapas      (id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_documentos_active  ON documentos (id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_noticias_active    ON noticias   (id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_categorias_active  ON categorias (id) WHERE deleted_at IS NULL;

COMMENT ON COLUMN mapas.deleted_at      IS 'Soft delete — NULL = activo, NOT NULL = en papelera';
COMMENT ON COLUMN documentos.deleted_at IS 'Soft delete — NULL = activo, NOT NULL = en papelera';
COMMENT ON COLUMN noticias.deleted_at   IS 'Soft delete — NULL = activo, NOT NULL = en papelera';
COMMENT ON COLUMN categorias.deleted_at IS 'Soft delete — NULL = activo, NOT NULL = en papelera';
