-- ─────────────────────────────────────────────────────────────────────────────
-- Compatibilidad con Postgres self-hosted (sin Supabase)
-- ─────────────────────────────────────────────────────────────────────────────
-- Las migraciones 002 y 030 crean políticas RLS "TO service_role" — ese rol
-- lo provee Supabase automáticamente, pero no existe en un Postgres propio
-- (servidor local del instituto, Docker, etc.), y esas migraciones fallarían
-- ahí con "role service_role does not exist".
--
-- La API siempre conecta como el superusuario configurado en DB_USER, que
-- bypassa RLS por defecto — estas políticas son una capa de defensa extra
-- pensada para el API REST automático de Supabase (PostgREST), irrelevante
-- si no se usa Supabase. Crear el rol (sin login, sin permisos propios) deja
-- que esas políticas se instalen igual en cualquier Postgres, sin cambiar el
-- modelo de seguridad ni tocar migraciones ya aplicadas en producción.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    CREATE ROLE service_role NOLOGIN NOINHERIT;
  END IF;
END
$$;
