-- 028_performance_indexes.sql
-- Índices de performance — basados en análisis de queries más frecuentes.
-- Todos son índices parciales o compuestos que minimizan tamaño y maximizan selectividad.

-- Listados públicos de mapas y documentos (ORDER BY creado_en DESC)
CREATE INDEX IF NOT EXISTS idx_mapas_creado_en
  ON mapas(creado_en DESC)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_documentos_creado_en
  ON documentos(creado_en DESC)
  WHERE deleted_at IS NULL;

-- Sort compuesto de documentos (ORDER BY anio DESC, creado_en DESC)
CREATE INDEX IF NOT EXISTS idx_documentos_anio_creado
  ON documentos(anio DESC, creado_en DESC)
  WHERE deleted_at IS NULL;

-- getMine() y rate-limit de solicitudes (WHERE usuario_id=$1 ORDER BY creado_en DESC)
-- También cubre: SELECT COUNT(*) WHERE usuario_id=$1 AND creado_en > NOW()-24h
CREATE INDEX IF NOT EXISTS idx_solicitudes_usuario_creado
  ON solicitudes(usuario_id, creado_en DESC);

-- getAdminEmails() y estadísticas (WHERE rol=... AND activo=...)
CREATE INDEX IF NOT EXISTS idx_usuarios_rol_activo
  ON usuarios(rol, activo)
  WHERE rol IN ('admin_sig', 'super_admin');

-- Notificaciones: usuarios pendientes de aprobación
CREATE INDEX IF NOT EXISTS idx_usuarios_activo_verified
  ON usuarios(activo, email_verified)
  WHERE activo = false;

-- getSessions() y revocación: sesiones activas por usuario
CREATE INDEX IF NOT EXISTS idx_refresh_tokens_activos
  ON refresh_tokens(usuario_id, creado_en DESC)
  WHERE revocado = false;

-- Visibilidad en mapas (filtro frecuente en listados públicos)
CREATE INDEX IF NOT EXISTS idx_mapas_visibilidad_activo
  ON mapas(visibilidad, activo)
  WHERE deleted_at IS NULL;

-- Visibilidad en documentos
CREATE INDEX IF NOT EXISTS idx_documentos_visibilidad_activo
  ON documentos(visibilidad, activo)
  WHERE deleted_at IS NULL;
