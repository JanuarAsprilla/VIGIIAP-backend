-- Visibilidad de contenido: publico | usuarios | acreditados
ALTER TABLE documentos
  ADD COLUMN IF NOT EXISTS visibilidad VARCHAR(50) NOT NULL DEFAULT 'publico';

ALTER TABLE noticias
  ADD COLUMN IF NOT EXISTS visibilidad VARCHAR(50) NOT NULL DEFAULT 'publico';

CREATE INDEX IF NOT EXISTS idx_documentos_visibilidad ON documentos(visibilidad);
CREATE INDEX IF NOT EXISTS idx_noticias_visibilidad   ON noticias(visibilidad);
