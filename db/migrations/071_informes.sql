-- 071: informes descargables configurables desde el panel de administración.
-- Dos niveles: la plantilla y las reglas generales (una sola fila) y los ajustes de cada herramienta que ofrece informe.
-- Por defecto solo descargan las cuentas con sesión ('usuarios'); 'publico' lo abre a cualquiera.

CREATE TABLE informes_config (
  id             SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  institucion    TEXT NOT NULL DEFAULT 'Vigía · IIAP' CHECK (char_length(institucion) BETWEEN 2 AND 120),
  subtitulo      TEXT CHECK (subtitulo IS NULL OR char_length(subtitulo) <= 200),
  pie            TEXT CHECK (pie IS NULL OR char_length(pie) <= 500),
  aviso          TEXT CHECK (aviso IS NULL OR char_length(aviso) <= 1000),
  color_primario TEXT NOT NULL DEFAULT '#009846' CHECK (color_primario ~ '^#[0-9A-Fa-f]{6}$'),
  color_acento   TEXT NOT NULL DEFAULT '#0F172A' CHECK (color_acento ~ '^#[0-9A-Fa-f]{6}$'),
  logo_url       TEXT CHECK (logo_url IS NULL OR char_length(logo_url) <= 500),
  acceso         TEXT NOT NULL DEFAULT 'usuarios' CHECK (acceso IN ('publico', 'usuarios')),
  formatos       TEXT[] NOT NULL DEFAULT ARRAY['pdf', 'xlsx']
                   CHECK (formatos <@ ARRAY['pdf', 'xlsx', 'csv'] AND cardinality(formatos) >= 1),
  -- Quién cambió qué queda en audit_log; sin clave foránea a usuarios para que la fila única sobreviva a cualquier borrado.
  actualizado_en TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO informes_config (id) VALUES (1);

CREATE TABLE informes_herramienta (
  herramienta    TEXT PRIMARY KEY REFERENCES herramientas(clave) ON UPDATE CASCADE ON DELETE CASCADE,
  activo         BOOLEAN NOT NULL DEFAULT true,
  -- NULL = usa los formatos generales
  formatos       TEXT[] CHECK (formatos IS NULL OR (formatos <@ ARRAY['pdf', 'xlsx', 'csv'] AND cardinality(formatos) >= 1)),
  max_filas      INTEGER NOT NULL DEFAULT 5000 CHECK (max_filas BETWEEN 100 AND 50000),
  actualizado_en TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO informes_herramienta (herramienta)
SELECT clave FROM herramientas WHERE clave = 'biodiversidad';

-- El catálogo de módulos delegables suma 'informes' (ver modulos.service.js); el CHECK debe conocerlo.
ALTER TABLE admin_permisos_modulo DROP CONSTRAINT IF EXISTS admin_permisos_modulo_modulo_check;
ALTER TABLE admin_permisos_modulo ADD CONSTRAINT admin_permisos_modulo_modulo_check CHECK (modulo IN (
  'usuarios', 'solicitudes', 'documentos', 'mapas',
  'geovisores', 'conexiones_geoserver', 'categorias',
  'herramientas', 'biodiversidad_datos', 'informes',
  'configuracion', 'actividad', 'errores', 'reportes', 'custodia'
));
