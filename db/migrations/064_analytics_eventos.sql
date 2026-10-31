-- Eventos personalizados de analítica: acciones concretas del visitante (descargar un mapa,
-- abrir un geovisor, usar una herramienta, buscar). El catálogo de nombres es cerrado y se
-- valida en el backend; aquí solo se acota el tamaño. Sin datos personales: el evento cuelga
-- de la sesión anónima y se borra con ella.
CREATE TABLE IF NOT EXISTS analytics_eventos (
  id         BIGSERIAL PRIMARY KEY,
  session_id UUID        NOT NULL REFERENCES analytics_sessions(id) ON DELETE CASCADE,
  nombre     TEXT        NOT NULL CHECK (char_length(nombre) <= 40),
  recurso    TEXT        CHECK (recurso IS NULL OR char_length(recurso) <= 200),
  ruta       TEXT        CHECK (ruta IS NULL OR char_length(ruta) <= 300),
  creado_en  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_analytics_eventos_nombre_fecha ON analytics_eventos (nombre, creado_en DESC);
CREATE INDEX IF NOT EXISTS idx_analytics_eventos_sesion       ON analytics_eventos (session_id);

-- "Tiempo real" consulta las sesiones con actividad en los últimos minutos.
CREATE INDEX IF NOT EXISTS idx_analytics_sessions_actividad ON analytics_sessions (ultima_actividad_en DESC) WHERE es_bot = false;

ALTER TABLE analytics_eventos ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_role full access" ON analytics_eventos
  TO service_role USING (true) WITH CHECK (true);
