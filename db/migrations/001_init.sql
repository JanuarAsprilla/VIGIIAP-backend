-- ─────────────────────────────────────────────────────────────────────────────
-- VIGIIAP — Migración inicial
-- Requiere: extensión PostGIS habilitada en Supabase
-- ─────────────────────────────────────────────────────────────────────────────

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS postgis;

-- ─── Enums ───────────────────────────────────────────────────────────────────
CREATE TYPE rol_usuario AS ENUM ('admin_sig', 'investigador', 'publico');
CREATE TYPE estado_solicitud AS ENUM ('pendiente', 'en_revision', 'aprobada', 'rechazada');

-- ─── Usuarios ─────────────────────────────────────────────────────────────────
CREATE TABLE usuarios (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  nombre          VARCHAR(150) NOT NULL,
  email           VARCHAR(255) NOT NULL UNIQUE,
  password_hash   TEXT NOT NULL,
  rol             rol_usuario NOT NULL DEFAULT 'publico',
  institucion     VARCHAR(200),
  motivo_acceso   TEXT,
  activo          BOOLEAN NOT NULL DEFAULT false,
  creado_en       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  actualizado_en  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_usuarios_email ON usuarios(email);
CREATE INDEX idx_usuarios_rol   ON usuarios(rol);

-- ─── Mapas ────────────────────────────────────────────────────────────────────
CREATE TABLE mapas (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  titulo          VARCHAR(300) NOT NULL,
  slug            VARCHAR(350) NOT NULL UNIQUE,
  categoria       VARCHAR(100) NOT NULL,
  anio            SMALLINT,
  descripcion     TEXT,
  thumbnail_url   TEXT,
  archivo_pdf_url TEXT,
  archivo_img_url TEXT,
  geovisor_url    TEXT,
  activo          BOOLEAN NOT NULL DEFAULT true,
  creado_por      UUID REFERENCES usuarios(id) ON DELETE SET NULL,
  creado_en       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  actualizado_en  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_mapas_categoria ON mapas(categoria);
CREATE INDEX idx_mapas_anio      ON mapas(anio);

-- ─── Documentos ───────────────────────────────────────────────────────────────
CREATE TABLE documentos (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  titulo      VARCHAR(400) NOT NULL,
  slug        VARCHAR(450) NOT NULL UNIQUE,
  tipo        VARCHAR(100) NOT NULL,  -- 'informe', 'articulo', 'libro', 'tesis', etc.
  anio        SMALLINT,
  autores     TEXT,
  resumen     TEXT,
  archivo_url TEXT,
  activo      BOOLEAN NOT NULL DEFAULT true,
  creado_por  UUID REFERENCES usuarios(id) ON DELETE SET NULL,
  creado_en   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  actualizado_en TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_documentos_tipo ON documentos(tipo);
CREATE INDEX idx_documentos_anio ON documentos(anio);

-- ─── Noticias ─────────────────────────────────────────────────────────────────
CREATE TABLE noticias (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  titulo       VARCHAR(400) NOT NULL,
  slug         VARCHAR(450) NOT NULL UNIQUE,
  categoria    VARCHAR(100),
  resumen      TEXT,
  contenido    TEXT,
  imagen_url   TEXT,
  publicado    BOOLEAN NOT NULL DEFAULT false,
  publicado_en TIMESTAMPTZ,
  creado_por   UUID REFERENCES usuarios(id) ON DELETE SET NULL,
  creado_en    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  actualizado_en TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_noticias_publicado_en ON noticias(publicado_en DESC);

-- ─── Solicitudes ──────────────────────────────────────────────────────────────
CREATE TABLE solicitudes (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tipo         VARCHAR(100) NOT NULL,  -- 'acceso', 'dato', 'colaboracion', etc.
  descripcion  TEXT NOT NULL,
  estado       estado_solicitud NOT NULL DEFAULT 'pendiente',
  nota_admin   TEXT,
  usuario_id   UUID NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  revisado_por UUID REFERENCES usuarios(id) ON DELETE SET NULL,
  creado_en    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  actualizado_en TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_solicitudes_estado     ON solicitudes(estado);
CREATE INDEX idx_solicitudes_usuario_id ON solicitudes(usuario_id);
