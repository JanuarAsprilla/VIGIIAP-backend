-- ─────────────────────────────────────────────────────────────────────────────
-- VIGIIAP — Portal de Geovisores: conexiones_geoserver + geovisores
-- ─────────────────────────────────────────────────────────────────────────────
-- Ver docs/PORTAL_GEOVISORES_DISENO.md para el diseño completo y las decisiones
-- ya confirmadas con el usuario (categorías compartidas con mapas/documentos,
-- conexiones GeoServer como tabla propia -no clave suelta de Configuración-,
-- permisos por rol).
--
-- Sin backfill: hoy no existe ningún geovisor como entidad propia (solo el
-- campo suelto mapas.geovisor_url), así que no hay datos que migrar, solo
-- esquema nuevo.

-- ─── 1. conexiones_geoserver ───────────────────────────────────────────────
-- Una fila por servidor GeoServer. CRUD exclusivo de super_admin (ver
-- authorize/requireSuperAdmin en el módulo). password_cifrado NUNCA se
-- guarda en texto plano — ver src/utils/geoserverEncryption.js.
CREATE TABLE conexiones_geoserver (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre            TEXT NOT NULL,
  url               TEXT NOT NULL,
  usuario_lectura   TEXT NOT NULL,
  password_cifrado  TEXT NOT NULL,
  timeout_ms        INTEGER NOT NULL DEFAULT 20000,
  activo            BOOLEAN NOT NULL DEFAULT true,
  creado_en         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  actualizado_en    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─── 2. geovisores ──────────────────────────────────────────────────────────
-- Una fila por geovisor publicado. workspaces_geoserver filtra qué workspaces
-- de la conexión aplican a este geovisor -- el catálogo de capas se descubre
-- en vivo contra GeoServer (WMS/WFS/WCS), nunca se copian capas a esta tabla.
CREATE TABLE geovisores (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug                  TEXT UNIQUE NOT NULL,
  titulo                TEXT NOT NULL,
  subtitulo             TEXT,
  descripcion           TEXT,
  cita                  TEXT,
  categoria             TEXT REFERENCES categorias(nombre),
  conexion_geoserver_id UUID NOT NULL REFERENCES conexiones_geoserver(id),
  workspaces_geoserver  TEXT[] NOT NULL DEFAULT '{}',
  color_por_tema        JSONB NOT NULL DEFAULT '{}',
  centro_lat            DOUBLE PRECISION NOT NULL,
  centro_lng            DOUBLE PRECISION NOT NULL,
  zoom_inicial          SMALLINT NOT NULL DEFAULT 8,
  basemap_defecto       TEXT NOT NULL DEFAULT 'calles',
  area_max_ha           NUMERIC,
  presets_area          JSONB NOT NULL DEFAULT '[]',
  ia_habilitada         BOOLEAN NOT NULL DEFAULT false,
  visibilidad           TEXT NOT NULL DEFAULT 'publico'
                          CHECK (visibilidad IN ('publico', 'usuarios', 'acreditados')),
  thumbnail_url         TEXT,
  activo                BOOLEAN NOT NULL DEFAULT true,
  orden                 SMALLINT NOT NULL DEFAULT 0,
  creado_por            UUID REFERENCES usuarios(id),
  creado_en             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  actualizado_en        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX geovisores_categoria_idx ON geovisores(categoria);
CREATE INDEX geovisores_conexion_geoserver_id_idx ON geovisores(conexion_geoserver_id);

-- ─── 3. RLS ─────────────────────────────────────────────────────────────────
-- Mismo patrón que 030_rls_missing_tables.sql: la API conecta como el rol de
-- servicio (bypassa RLS), esto solo bloquea el acceso público vía PostgREST.
ALTER TABLE conexiones_geoserver ENABLE ROW LEVEL SECURITY;
ALTER TABLE geovisores           ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role full access" ON conexiones_geoserver
  TO service_role USING (true) WITH CHECK (true);

CREATE POLICY "service_role full access" ON geovisores
  TO service_role USING (true) WITH CHECK (true);
