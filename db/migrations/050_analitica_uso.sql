-- ─────────────────────────────────────────────────────────────────────────────
-- VIGIIAP — Analítica de uso anónima (tipo Google Analytics), autoalojada
-- ─────────────────────────────────────────────────────────────────────────────
-- Vive junto a `audit_log` (003_audit_notifications.sql) pero es un concepto
-- distinto a propósito: audit_log es rastro de SEGURIDAD (quién hizo qué,
-- ligado a usuario_id/email/ip, con fines de auditoría/legal). Esto es
-- comportamiento de navegación ANÓNIMO con fines de producto -- nunca se
-- guarda IP, user_id ni ningún dato que identifique a la persona, ni siquiera
-- para usuarios con sesión iniciada (decisión explícita del cliente). Mezclar
-- ambos en la misma tabla habría obligado a elegir entre las políticas de
-- retención/acceso de una auditoría legal y las de analítica de producto.
--
-- `session_id` es un UUID generado en el navegador (sessionStorage, rota tras
-- 30 min de inactividad -- ver src/lib/analyticsSession.ts en el frontend).
-- No es un identificador estable de persona: cambia cada sesión y cada
-- pestaña/dispositivo, y no hay tabla de usuarios que lo referencie.
CREATE TABLE analytics_sessions (
  id                UUID PRIMARY KEY,
  primera_visita_en TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ultima_actividad_en TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  dispositivo       TEXT NOT NULL CHECK (dispositivo IN ('movil', 'tablet', 'escritorio')),
  navegador         TEXT CHECK (navegador IS NULL OR char_length(navegador) <= 40),
  sistema_operativo TEXT CHECK (sistema_operativo IS NULL OR char_length(sistema_operativo) <= 40),
  referrer_inicial  TEXT CHECK (referrer_inicial IS NULL OR char_length(referrer_inicial) <= 300),
  utm_source        TEXT CHECK (utm_source IS NULL OR char_length(utm_source) <= 100),
  utm_medium        TEXT CHECK (utm_medium IS NULL OR char_length(utm_medium) <= 100),
  utm_campaign      TEXT CHECK (utm_campaign IS NULL OR char_length(utm_campaign) <= 100),
  es_bot            BOOLEAN NOT NULL DEFAULT false
);

-- Sin `tiempo_en_pagina`: se deriva analíticamente al consultar (LEAD/LAG
-- sobre `creado_en` particionado por session_id), evita un segundo beacon de
-- "salida de página" por cada vista (menos tráfico, menos superficie).
CREATE TABLE analytics_pageviews (
  id            BIGSERIAL PRIMARY KEY,
  session_id    UUID NOT NULL REFERENCES analytics_sessions(id) ON DELETE CASCADE,
  ruta          TEXT NOT NULL CHECK (char_length(ruta) BETWEEN 1 AND 300),
  titulo        TEXT CHECK (titulo IS NULL OR char_length(titulo) <= 200),
  es_entrada    BOOLEAN NOT NULL DEFAULT false,
  es_area_admin BOOLEAN NOT NULL DEFAULT false,
  creado_en     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_analytics_pageviews_creado_en ON analytics_pageviews (creado_en DESC);
CREATE INDEX idx_analytics_pageviews_session   ON analytics_pageviews (session_id, creado_en);
CREATE INDEX idx_analytics_pageviews_ruta       ON analytics_pageviews (ruta);
CREATE INDEX idx_analytics_sessions_primera     ON analytics_sessions (primera_visita_en DESC);

-- RLS: mismo patrón que el resto del proyecto -- la API conecta como
-- service_role (bypassa RLS), esto solo bloquea PostgREST directo.
ALTER TABLE analytics_sessions  ENABLE ROW LEVEL SECURITY;
ALTER TABLE analytics_pageviews ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role full access" ON analytics_sessions
  TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "service_role full access" ON analytics_pageviews
  TO service_role USING (true) WITH CHECK (true);

-- Reutiliza el módulo 'actividad' ya existente en admin_permisos_modulo (ver
-- 038_admin_permisos_modulo.sql) -- la analítica vive dentro de la misma
-- pantalla de "Actividad" del panel admin (pestaña nueva, no un módulo
-- nuevo), así que no hace falta tocar el catálogo de módulos delegables.
