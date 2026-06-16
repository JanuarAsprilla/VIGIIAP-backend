-- 016: Índices faltantes identificados en auditoría de seguridad/arquitectura

-- activo (mapas y documentos) — filtro presente en todos los list queries y getBySlug
CREATE INDEX IF NOT EXISTS idx_mapas_activo      ON mapas(activo)      WHERE activo = true;
CREATE INDEX IF NOT EXISTS idx_documentos_activo ON documentos(activo) WHERE activo = true;

-- publicado (noticias) — equivalente de activo para noticias
CREATE INDEX IF NOT EXISTS idx_noticias_publicado ON noticias(publicado) WHERE publicado = true;

-- visibilidad en mapas (migrations 006 lo crea para documentos y noticias, pero 007 no lo creó para mapas)
CREATE INDEX IF NOT EXISTS idx_mapas_visibilidad ON mapas(visibilidad);
