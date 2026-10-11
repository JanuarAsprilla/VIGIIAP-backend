-- Ubicación aproximada e IP en la analítica (Actividad, fase 3).
-- Reemplaza la regla de la migración 050 ("nunca se guarda IP") por decisión explícita del
-- cliente (2026-10-11): cada sesión guarda su IP y la ubicación aproximada derivada de ella
-- con una base local (sin enviar la IP a terceros). La IP es dato personal (Ley 1581 de 2012):
-- se borra automáticamente pasados ANALITICA_IP_RETENCION_DIAS (90 por defecto) y la sesión
-- completa pasados ANALITICA_RETENCION_DIAS (730); ver src/utils/retencionDatos.js.
ALTER TABLE analytics_sessions
  ADD COLUMN ip           TEXT CHECK (ip IS NULL OR char_length(ip) <= 45),
  ADD COLUMN pais         TEXT CHECK (pais IS NULL OR char_length(pais) <= 2),
  ADD COLUMN departamento TEXT CHECK (departamento IS NULL OR char_length(departamento) <= 60),
  ADD COLUMN ciudad       TEXT CHECK (ciudad IS NULL OR char_length(ciudad) <= 80);

CREATE INDEX idx_analytics_sessions_departamento
  ON analytics_sessions (departamento) WHERE departamento IS NOT NULL;

-- Acelera la purga: solo indexa las sesiones que todavía conservan la IP.
CREATE INDEX idx_analytics_sessions_ip_vigente
  ON analytics_sessions (primera_visita_en) WHERE ip IS NOT NULL;
