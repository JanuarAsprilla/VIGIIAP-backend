-- ─────────────────────────────────────────────────────────────────────────────
-- VIGIIAP — Biodiversidad: esquema base (herramienta «Observatorio de biodiversidad»)
-- ─────────────────────────────────────────────────────────────────────────────
-- Solo agrega: un esquema propio `biodiversidad` y un rol de ingesta. No altera ni
-- borra nada existente. Reversión: db/rollback/062_biodiversidad_base.down.sql.
--
-- Diseño de seguridad
--  · Esquema aparte, no expuesto por la API REST automática de Supabase (PostgREST
--    solo publica los esquemas configurados) y con PUBLIC/anon/authenticated sin acceso.
--  · RLS activo en TODAS las tablas. Nuestra API conecta como "postgres" (dueño, bypassa
--    RLS), así que no se crea política para service_role: menos privilegios, no más.
--  · `biodiversidad_ingesta` (NOLOGIN): el único rol que usará el worker que descarga de
--    GBIF. Solo escribe en este esquema; no ve usuarios, tokens ni herramientas. El
--    administrador de BD le asigna LOGIN y contraseña fuera de la migración (no se
--    versionan secretos).
--  · `vw_registro_publico` oculta latitud/longitud/incertidumbre de especies amenazadas
--    (CR/EN/VU, lista MADS) y FALLA CERRADO: sin un cruce de conservación activo oculta
--    todas las coordenadas. La capa de API debe leer los registros por esta vista.
--
-- La migración es idempotente (se puede reaplicar sin error) y no usa PostGIS: la
-- geometría municipal la sirve el visor existente; el worker la usa solo al asignar.

CREATE SCHEMA IF NOT EXISTS biodiversidad;
COMMENT ON SCHEMA biodiversidad IS
  'Observatorio de biodiversidad del Chocó biogeográfico: registros GBIF y cruce con listas de conservación. Ver db/migrations/062_biodiversidad_base.sql.';

-- ─── 1. Catálogos ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS biodiversidad.clasificacion (
  clave  TEXT PRIMARY KEY,
  nombre TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS biodiversidad.territorio_version (
  huella    TEXT PRIMARY KEY,
  origen    TEXT NOT NULL,
  creado_en TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS biodiversidad.municipio (
  territorio_huella TEXT NOT NULL REFERENCES biodiversidad.territorio_version(huella),
  codigo            TEXT NOT NULL CHECK (char_length(codigo) BETWEEN 1 AND 20),
  nombre            TEXT NOT NULL,
  departamento      TEXT NOT NULL,
  PRIMARY KEY (territorio_huella, codigo)
);

CREATE TABLE IF NOT EXISTS biodiversidad.entidad (
  clave          TEXT PRIMARY KEY,
  nombre         TEXT NOT NULL,
  metadatos      JSONB NOT NULL DEFAULT '{}',
  consultado_en  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS biodiversidad.conjunto (
  clave          TEXT PRIMARY KEY,
  titulo         TEXT NOT NULL,
  entidad_clave  TEXT REFERENCES biodiversidad.entidad(clave),
  doi            TEXT,
  licencia       TEXT,
  metadatos      JSONB NOT NULL DEFAULT '{}',
  consultado_en  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─── 2. Lotes (cortes de datos) y taxonomía ───────────────────────────────────
CREATE TABLE IF NOT EXISTS biodiversidad.lote (
  id                  BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  grupo               TEXT NOT NULL,
  metodo              TEXT NOT NULL CHECK (metodo IN ('individual', 'agregado')),
  clasificacion_clave TEXT NOT NULL REFERENCES biodiversidad.clasificacion(clave),
  territorio_huella   TEXT NOT NULL REFERENCES biodiversidad.territorio_version(huella),
  desde               INTEGER NOT NULL,
  hasta               INTEGER NOT NULL,
  huella_fuente       TEXT NOT NULL,
  origen              TEXT NOT NULL,
  doi                 TEXT,
  creado_en           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  fecha_fuente        TIMESTAMPTZ,
  registros           BIGINT NOT NULL CHECK (registros >= 0),
  estado              TEXT NOT NULL CHECK (estado IN ('cargando', 'completo')),
  activo              BOOLEAN NOT NULL DEFAULT false,
  CHECK (desde <= hasta),
  CHECK (NOT activo OR estado = 'completo'),
  UNIQUE (grupo, metodo, clasificacion_clave, territorio_huella, desde, hasta, huella_fuente)
);
CREATE UNIQUE INDEX IF NOT EXISTS un_lote_activo ON biodiversidad.lote (grupo) WHERE activo;

CREATE TABLE IF NOT EXISTS biodiversidad.taxon_version (
  huella              TEXT PRIMARY KEY,
  clasificacion_clave TEXT NOT NULL REFERENCES biodiversidad.clasificacion(clave),
  taxon_clave         TEXT NOT NULL,
  rango               TEXT,
  nombre_cientifico   TEXT,
  estado_taxonomico   TEXT,
  aceptado_clave      TEXT,
  reino_clave         TEXT, reino    TEXT,
  division_clave      TEXT, division TEXT,
  clase_clave         TEXT, clase    TEXT,
  orden_clave         TEXT, orden    TEXT,
  familia_clave       TEXT, familia  TEXT,
  genero_clave        TEXT, genero   TEXT,
  especie_clave       TEXT, especie  TEXT,
  linaje              JSONB NOT NULL
);
CREATE INDEX IF NOT EXISTS taxon_jerarquia
  ON biodiversidad.taxon_version (clasificacion_clave, reino, division, clase, orden, familia, genero, especie);
CREATE INDEX IF NOT EXISTS taxon_especie
  ON biodiversidad.taxon_version (clasificacion_clave, especie_clave);

-- ─── 3. Registros e inventarios ───────────────────────────────────────────────
-- latitud/longitud EXACTAS: no leer esta tabla desde la API pública, usar vw_registro_publico.
CREATE TABLE IF NOT EXISTS biodiversidad.registro (
  lote_id          BIGINT NOT NULL REFERENCES biodiversidad.lote(id),
  gbif_id          TEXT NOT NULL,
  dataset_key      TEXT NOT NULL REFERENCES biodiversidad.conjunto(clave),
  taxon_huella     TEXT REFERENCES biodiversidad.taxon_version(huella),
  occurrence_id    TEXT,
  fecha_evento     TEXT,
  anio             INTEGER,
  latitud          DOUBLE PRECISION CHECK (latitud  BETWEEN  -90 AND  90),
  longitud         DOUBLE PRECISION CHECK (longitud BETWEEN -180 AND 180),
  incertidumbre_m  DOUBLE PRECISION CHECK (incertidumbre_m >= 0),
  tipo_evidencia   TEXT,
  licencia         TEXT,
  institution_code TEXT,
  collection_code  TEXT,
  catalog_number   TEXT,
  nombre_original  TEXT,
  last_interpreted TEXT,
  modified         TEXT,
  marcas_revision  TEXT,
  vista_1000m      BOOLEAN NOT NULL,
  PRIMARY KEY (lote_id, gbif_id)
);
CREATE INDEX IF NOT EXISTS registro_fuente ON biodiversidad.registro (lote_id, dataset_key);
CREATE INDEX IF NOT EXISTS registro_taxon  ON biodiversidad.registro (taxon_huella);

CREATE TABLE IF NOT EXISTS biodiversidad.asignacion (
  lote_id           BIGINT NOT NULL,
  gbif_id           TEXT NOT NULL,
  territorio_huella TEXT NOT NULL,
  codigo            TEXT NOT NULL,
  PRIMARY KEY (lote_id, gbif_id, codigo),
  FOREIGN KEY (lote_id, gbif_id) REFERENCES biodiversidad.registro(lote_id, gbif_id),
  FOREIGN KEY (territorio_huella, codigo) REFERENCES biodiversidad.municipio(territorio_huella, codigo)
);
CREATE INDEX IF NOT EXISTS asignacion_municipal ON biodiversidad.asignacion (territorio_huella, codigo, lote_id);

CREATE TABLE IF NOT EXISTS biodiversidad.resumen_territorial (
  lote_id           BIGINT NOT NULL REFERENCES biodiversidad.lote(id),
  territorio_huella TEXT NOT NULL,
  codigo            TEXT NOT NULL,
  registros         BIGINT NOT NULL CHECK (registros >= 0),
  sin_especie       BIGINT NOT NULL CHECK (sin_especie >= 0),
  PRIMARY KEY (lote_id, codigo),
  FOREIGN KEY (territorio_huella, codigo) REFERENCES biodiversidad.municipio(territorio_huella, codigo)
);

CREATE TABLE IF NOT EXISTS biodiversidad.inventario_especie (
  lote_id      BIGINT NOT NULL REFERENCES biodiversidad.lote(id),
  codigo       TEXT NOT NULL,
  taxon_huella TEXT NOT NULL REFERENCES biodiversidad.taxon_version(huella),
  registros    BIGINT NOT NULL CHECK (registros > 0),
  PRIMARY KEY (lote_id, codigo, taxon_huella),
  FOREIGN KEY (lote_id, codigo) REFERENCES biodiversidad.resumen_territorial(lote_id, codigo)
);
CREATE INDEX IF NOT EXISTS inventario_taxon ON biodiversidad.inventario_especie (taxon_huella);

CREATE TABLE IF NOT EXISTS biodiversidad.conteo_fuente (
  lote_id     BIGINT NOT NULL REFERENCES biodiversidad.lote(id),
  codigo      TEXT NOT NULL,
  dataset_key TEXT NOT NULL REFERENCES biodiversidad.conjunto(clave),
  registros   BIGINT NOT NULL CHECK (registros > 0),
  PRIMARY KEY (lote_id, codigo, dataset_key),
  FOREIGN KEY (lote_id, codigo) REFERENCES biodiversidad.resumen_territorial(lote_id, codigo)
);

-- Año y tipo de evidencia por municipio de los lotes agregados (no se cruzan con especies).
CREATE TABLE IF NOT EXISTS biodiversidad.faceta_municipal (
  lote_id   BIGINT NOT NULL REFERENCES biodiversidad.lote(id),
  codigo    TEXT NOT NULL,
  faceta    TEXT NOT NULL CHECK (faceta IN ('anio', 'tipo_evidencia')),
  valor     TEXT NOT NULL,
  registros BIGINT NOT NULL CHECK (registros > 0),
  PRIMARY KEY (lote_id, codigo, faceta, valor),
  FOREIGN KEY (lote_id, codigo) REFERENCES biodiversidad.resumen_territorial(lote_id, codigo)
);

CREATE TABLE IF NOT EXISTS biodiversidad.actualizacion (
  id        BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  inicio_en TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  fin_en    TIMESTAMPTZ,
  grupo     TEXT,
  modo      TEXT,
  estado    TEXT NOT NULL CHECK (estado IN ('en_curso', 'completo', 'error', 'descarga_requerida')),
  mensaje   TEXT,
  lote_id   BIGINT REFERENCES biodiversidad.lote(id),
  detalle   JSONB NOT NULL DEFAULT '{}'
);

-- ─── 4. Cruce con listas de conservación ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS biodiversidad.conservacion_importacion (
  id        BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  creado_en TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  huella    TEXT NOT NULL UNIQUE,
  activo    BOOLEAN NOT NULL DEFAULT false,
  informe   JSONB NOT NULL DEFAULT '{}'
);
CREATE UNIQUE INDEX IF NOT EXISTS conservacion_un_activo
  ON biodiversidad.conservacion_importacion (activo) WHERE activo;

CREATE TABLE IF NOT EXISTS biodiversidad.conservacion_fuente (
  importacion_id BIGINT NOT NULL REFERENCES biodiversidad.conservacion_importacion(id),
  slug           TEXT NOT NULL,
  metadatos      JSONB NOT NULL DEFAULT '{}',
  PRIMARY KEY (importacion_id, slug)
);

CREATE TABLE IF NOT EXISTS biodiversidad.conservacion_afirmacion (
  id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  importacion_id  BIGINT NOT NULL REFERENCES biodiversidad.conservacion_importacion(id),
  fuente          TEXT NOT NULL,
  id_original     TEXT,
  nombre          TEXT,
  reino           TEXT,
  rango           TEXT,
  tema            TEXT NOT NULL,
  valor           TEXT,
  campo           TEXT,
  original        JSONB NOT NULL DEFAULT '{}',
  motivo_revision TEXT
);
CREATE INDEX IF NOT EXISTS conservacion_afirmacion_tema ON biodiversidad.conservacion_afirmacion (importacion_id, tema);

CREATE TABLE IF NOT EXISTS biodiversidad.conservacion_vinculo (
  afirmacion_id       BIGINT NOT NULL REFERENCES biodiversidad.conservacion_afirmacion(id),
  clasificacion_clave TEXT NOT NULL,
  especie_clave       TEXT NOT NULL,
  metodo              TEXT NOT NULL,
  PRIMARY KEY (afirmacion_id, clasificacion_clave, especie_clave)
);
CREATE INDEX IF NOT EXISTS conservacion_busqueda
  ON biodiversidad.conservacion_vinculo (clasificacion_clave, especie_clave);

-- ─── 5. Vistas ────────────────────────────────────────────────────────────────
CREATE OR REPLACE VIEW biodiversidad.vw_taxon_amenazado AS
  SELECT DISTINCT v.clasificacion_clave, v.especie_clave, a.valor AS categoria
    FROM biodiversidad.conservacion_vinculo v
    JOIN biodiversidad.conservacion_afirmacion a ON a.id = v.afirmacion_id
    JOIN biodiversidad.conservacion_importacion i ON i.id = a.importacion_id AND i.activo
   WHERE a.tema = 'amenaza_nacional' AND a.valor IN ('CR', 'EN', 'VU');

-- Ubicación oculta cuando: no hay cruce activo (falla cerrado), la especie es amenazada
-- o el registro no tiene especie determinada (no se puede verificar).
CREATE OR REPLACE VIEW biodiversidad.vw_registro_publico AS
  SELECT r.lote_id, l.grupo, r.gbif_id, r.dataset_key, r.taxon_huella,
         t.especie_clave, t.especie, r.anio, r.fecha_evento, r.tipo_evidencia, r.licencia,
         CASE WHEN x.oculta THEN NULL ELSE r.latitud         END AS latitud,
         CASE WHEN x.oculta THEN NULL ELSE r.longitud        END AS longitud,
         CASE WHEN x.oculta THEN NULL ELSE r.incertidumbre_m END AS incertidumbre_m,
         x.oculta AS coordenadas_ocultas
    FROM biodiversidad.registro r
    JOIN biodiversidad.lote l ON l.id = r.lote_id AND l.activo AND l.estado = 'completo'
    LEFT JOIN biodiversidad.taxon_version t ON t.huella = r.taxon_huella
   CROSS JOIN LATERAL (
     SELECT (
       NOT EXISTS (SELECT 1 FROM biodiversidad.conservacion_importacion WHERE activo)
       OR t.especie_clave IS NULL
       OR EXISTS (SELECT 1 FROM biodiversidad.vw_taxon_amenazado z
                   WHERE z.clasificacion_clave = t.clasificacion_clave
                     AND z.especie_clave = t.especie_clave)
     ) AS oculta
   ) x;

-- ─── 6. Rol de ingesta y permisos ─────────────────────────────────────────────
-- Si quien migra no puede crear roles, la migración NO falla (tumbaría el arranque del
-- servidor): avisa, y un administrador crea el rol y reaplica los GRANT a mano.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'biodiversidad_ingesta') THEN
    CREATE ROLE biodiversidad_ingesta NOLOGIN NOINHERIT;
  END IF;
EXCEPTION WHEN insufficient_privilege THEN
  RAISE NOTICE 'biodiversidad: sin privilegio para crear el rol biodiversidad_ingesta; créelo a mano.';
END $$;

-- Nadie fuera del dueño y del rol de ingesta toca este esquema.
REVOKE ALL ON SCHEMA biodiversidad FROM PUBLIC;
REVOKE ALL ON ALL TABLES IN SCHEMA biodiversidad FROM PUBLIC;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA biodiversidad FROM PUBLIC;

DO $$
DECLARE
  rol   TEXT;
  tabla TEXT;
BEGIN
  FOREACH rol IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = rol) THEN
      EXECUTE format('REVOKE ALL ON SCHEMA biodiversidad FROM %I', rol);
      EXECUTE format('REVOKE ALL ON ALL TABLES IN SCHEMA biodiversidad FROM %I', rol);
      EXECUTE format('REVOKE ALL ON ALL SEQUENCES IN SCHEMA biodiversidad FROM %I', rol);
    END IF;
  END LOOP;

  FOR tabla IN SELECT tablename FROM pg_tables WHERE schemaname = 'biodiversidad' LOOP
    EXECUTE format('ALTER TABLE biodiversidad.%I ENABLE ROW LEVEL SECURITY', tabla);
  END LOOP;

  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'biodiversidad_ingesta') THEN
    GRANT USAGE ON SCHEMA biodiversidad TO biodiversidad_ingesta;
    GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA biodiversidad TO biodiversidad_ingesta;
    FOR tabla IN SELECT tablename FROM pg_tables WHERE schemaname = 'biodiversidad' LOOP
      EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON biodiversidad.%I TO biodiversidad_ingesta', tabla);
      EXECUTE format('DROP POLICY IF EXISTS ingesta_acceso_total ON biodiversidad.%I', tabla);
      EXECUTE format('CREATE POLICY ingesta_acceso_total ON biodiversidad.%I TO biodiversidad_ingesta USING (true) WITH CHECK (true)', tabla);
    END LOOP;
    -- Las vistas son solo de lectura para el worker.
    GRANT SELECT ON biodiversidad.vw_taxon_amenazado, biodiversidad.vw_registro_publico TO biodiversidad_ingesta;
  END IF;
END $$;
