-- ─────────────────────────────────────────────────────────────────────────────
-- VIGIIAP — Seguridad: RLS + PostGIS en schema extensions
-- ─────────────────────────────────────────────────────────────────────────────

-- ─── 1. Habilitar RLS en todas las tablas de aplicación ───────────────────────
ALTER TABLE usuarios     ENABLE ROW LEVEL SECURITY;
ALTER TABLE mapas        ENABLE ROW LEVEL SECURITY;
ALTER TABLE documentos   ENABLE ROW LEVEL SECURITY;
ALTER TABLE noticias     ENABLE ROW LEVEL SECURITY;
ALTER TABLE solicitudes  ENABLE ROW LEVEL SECURITY;
ALTER TABLE _migraciones ENABLE ROW LEVEL SECURITY;

-- ─── 2. Políticas de acceso para el rol de la API ─────────────────────────────
-- Nuestra API conecta como "postgres" (superuser) → bypassa RLS por defecto.
-- Estas políticas cubren el rol "authenticator" / service_role de Supabase
-- y garantizan acceso completo desde la capa de servidor.

CREATE POLICY "service_role full access" ON usuarios
  TO service_role USING (true) WITH CHECK (true);

CREATE POLICY "service_role full access" ON mapas
  TO service_role USING (true) WITH CHECK (true);

CREATE POLICY "service_role full access" ON documentos
  TO service_role USING (true) WITH CHECK (true);

CREATE POLICY "service_role full access" ON noticias
  TO service_role USING (true) WITH CHECK (true);

CREATE POLICY "service_role full access" ON solicitudes
  TO service_role USING (true) WITH CHECK (true);

CREATE POLICY "service_role full access" ON _migraciones
  TO service_role USING (true) WITH CHECK (true);

-- NOTA: PostGIS no soporta ALTER EXTENSION ... SET SCHEMA.
-- El warning "Extension in Public" es cosmético — PostGIS instala en public
-- por diseño y Supabase lo instala así por defecto. No representa un riesgo
-- de seguridad ya que spatial_ref_sys solo contiene datos de referencia SRS.
