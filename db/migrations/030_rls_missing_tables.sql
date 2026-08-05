-- ─────────────────────────────────────────────────────────────────────────────
-- VIGIIAP — Seguridad: RLS en tablas de soporte/auditoría agregadas tras 002
-- ─────────────────────────────────────────────────────────────────────────────
-- La migración 002 activó RLS en las tablas base (usuarios, mapas, documentos,
-- noticias, solicitudes, _migraciones). Las tablas creadas en migraciones
-- posteriores (013, 015, 018, 024 y otras) quedaron sin RLS por descuido —
-- expuestas por completo a los roles "anon"/"authenticated" de la API REST
-- automática de Supabase (PostgREST), sin pasar por nuestra API Node/Express.
--
-- Nuestra API conecta como "postgres" (bypassa RLS por defecto), así que este
-- cambio no afecta al backend. Solo bloquea el acceso público vía PostgREST.

-- ─── 1. Habilitar RLS en las tablas de soporte/auditoría ──────────────────────
ALTER TABLE audit_log         ENABLE ROW LEVEL SECURITY;
ALTER TABLE visitantes        ENABLE ROW LEVEL SECURITY;
ALTER TABLE configuracion     ENABLE ROW LEVEL SECURITY;
ALTER TABLE categorias        ENABLE ROW LEVEL SECURITY;
ALTER TABLE file_scan_log     ENABLE ROW LEVEL SECURITY;
ALTER TABLE geo_custodia      ENABLE ROW LEVEL SECURITY;
ALTER TABLE descarga_log      ENABLE ROW LEVEL SECURITY;
ALTER TABLE revoked_tokens    ENABLE ROW LEVEL SECURITY;
ALTER TABLE refresh_tokens    ENABLE ROW LEVEL SECURITY;
ALTER TABLE solicitud_archivos ENABLE ROW LEVEL SECURITY;
ALTER TABLE spatial_ref_sys   ENABLE ROW LEVEL SECURITY;

-- ─── 2. Políticas de acceso para el rol de servicio (mismo patrón que 002) ────
CREATE POLICY "service_role full access" ON audit_log
  TO service_role USING (true) WITH CHECK (true);

CREATE POLICY "service_role full access" ON visitantes
  TO service_role USING (true) WITH CHECK (true);

CREATE POLICY "service_role full access" ON configuracion
  TO service_role USING (true) WITH CHECK (true);

CREATE POLICY "service_role full access" ON categorias
  TO service_role USING (true) WITH CHECK (true);

CREATE POLICY "service_role full access" ON file_scan_log
  TO service_role USING (true) WITH CHECK (true);

CREATE POLICY "service_role full access" ON geo_custodia
  TO service_role USING (true) WITH CHECK (true);

CREATE POLICY "service_role full access" ON descarga_log
  TO service_role USING (true) WITH CHECK (true);

CREATE POLICY "service_role full access" ON revoked_tokens
  TO service_role USING (true) WITH CHECK (true);

CREATE POLICY "service_role full access" ON refresh_tokens
  TO service_role USING (true) WITH CHECK (true);

CREATE POLICY "service_role full access" ON solicitud_archivos
  TO service_role USING (true) WITH CHECK (true);

-- spatial_ref_sys es tabla de referencia de PostGIS (definiciones SRS, no
-- datos sensibles) — RLS aquí protege su integridad, no confidencialidad.
CREATE POLICY "service_role full access" ON spatial_ref_sys
  TO service_role USING (true) WITH CHECK (true);
