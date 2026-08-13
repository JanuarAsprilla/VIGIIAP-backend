-- 031: Índices en foreign keys sin cobertura (detectados por el advisor de
-- performance de Supabase). Bajo impacto hoy por volumen de datos, pero
-- evita seq scans en JOINs y ON DELETE cuando la tabla crezca.

CREATE INDEX IF NOT EXISTS idx_documentos_creado_por
  ON documentos(creado_por);

CREATE INDEX IF NOT EXISTS idx_mapas_creado_por
  ON mapas(creado_por);

CREATE INDEX IF NOT EXISTS idx_noticias_creado_por
  ON noticias(creado_por);

CREATE INDEX IF NOT EXISTS idx_solicitud_archivos_subido_por
  ON solicitud_archivos(subido_por);

CREATE INDEX IF NOT EXISTS idx_solicitudes_revisado_por
  ON solicitudes(revisado_por);
