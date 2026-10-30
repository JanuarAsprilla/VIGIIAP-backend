-- Índices de rendimiento surgidos de medir las consultas reales sobre ~2,2 M de filas sintéticas.
-- Es idempotente y no bloquea el arranque si la extensión pg_trgm no está disponible.

-- Búsquedas ILIKE '%texto%' (listados de mapas, documentos y usuarios): sin trigramas recorren la tabla.
DO $$
BEGIN
  CREATE EXTENSION IF NOT EXISTS pg_trgm;
  CREATE INDEX IF NOT EXISTS idx_mapas_titulo_trgm      ON mapas      USING gin (titulo gin_trgm_ops);
  CREATE INDEX IF NOT EXISTS idx_mapas_descripcion_trgm ON mapas      USING gin (descripcion gin_trgm_ops);
  CREATE INDEX IF NOT EXISTS idx_documentos_titulo_trgm ON documentos USING gin (titulo gin_trgm_ops);
  CREATE INDEX IF NOT EXISTS idx_usuarios_nombre_trgm   ON usuarios   USING gin (nombre gin_trgm_ops);
  CREATE INDEX IF NOT EXISTS idx_usuarios_email_trgm    ON usuarios   USING gin (email gin_trgm_ops);
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'pg_trgm no disponible, se omiten los índices de trigramas: %', SQLERRM;
END $$;

-- Historial de descargas por usuario (de ~15 ms a ~0,1 ms).
CREATE INDEX IF NOT EXISTS idx_descarga_log_usuario_email ON descarga_log (usuario_email, created_at DESC);

-- Purga de sesiones vencidas o revocadas.
CREATE INDEX IF NOT EXISTS idx_refresh_tokens_expira    ON refresh_tokens (expira_en);
CREATE INDEX IF NOT EXISTS idx_refresh_tokens_revocados ON refresh_tokens (creado_en) WHERE revocado = true;

-- Claves foráneas sin índice: el borrado de un usuario recorría estas tablas enteras.
CREATE INDEX IF NOT EXISTS idx_geovisores_creado_por           ON geovisores (creado_por);
CREATE INDEX IF NOT EXISTS idx_capas_fichas_config_creado_por  ON capas_fichas_config (creado_por);
CREATE INDEX IF NOT EXISTS idx_fichas_punto_creado_por         ON fichas_punto (creado_por);
CREATE INDEX IF NOT EXISTS idx_fichas_punto_actualizado_por    ON fichas_punto (actualizado_por);
CREATE INDEX IF NOT EXISTS idx_fichas_punto_medios_creado_por  ON fichas_punto_medios (creado_por);
CREATE INDEX IF NOT EXISTS idx_usuario_notificacion_prefs_tipo ON usuario_notificacion_prefs (tipo_clave);

-- Índices duplicados: ya los cubre una restricción UNIQUE o un índice compuesto con el mismo prefijo.
DROP INDEX IF EXISTS idx_usuarios_email;
DROP INDEX IF EXISTS idx_refresh_tokens_hash;
DROP INDEX IF EXISTS idx_solicitudes_usuario_id;
