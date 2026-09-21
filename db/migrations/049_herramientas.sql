-- ─────────────────────────────────────────────────────────────────────────────
-- VIGIIAP — Catálogo administrable de herramientas (/herramientas)
-- ─────────────────────────────────────────────────────────────────────────────
-- Antes, el listado de herramientas vivía 100% hardcodeado en el frontend
-- (TOOLS_META en Herramientas.tsx) -- activar, ocultar o reordenar una
-- herramienta exigía un despliegue de código. Esta tabla separa el CONTENIDO
-- administrable (título, descripción, tag, si está activa, orden) del
-- COMPONENTE real (sigue siendo código -- ver el registro estático en el
-- frontend que mapea `clave` -> componente/ícono/color). `clave` es la clave
-- primaria y debe coincidir exactamente con una clave de ese registro
-- frontend; crear una fila con una clave sin componente shippeado no rompe
-- nada (el frontend descarta silenciosamente las claves que no reconoce),
-- pero tampoco hace aparecer una herramienta de la nada.
--
-- Igual que admin_permisos_modulo (ver 038), no hay campo `rol_visible`
-- todavía -- ninguna herramienta hoy necesita ocultarse solo para ciertos
-- roles (público/visitante ya ven todo en modo lectura dentro de cada
-- herramienta, ver PanelChocoBiogeografico). Agregar esa columna es trivial
-- el día que haga falta -- YAGNI por ahora.
CREATE TABLE herramientas (
  clave          TEXT PRIMARY KEY CHECK (clave ~ '^[a-z0-9-]{2,50}$'),
  titulo         TEXT NOT NULL CHECK (char_length(titulo) BETWEEN 2 AND 150),
  descripcion    TEXT CHECK (descripcion IS NULL OR char_length(descripcion) <= 500),
  tag            TEXT NOT NULL CHECK (char_length(tag) BETWEEN 2 AND 40),
  activa         BOOLEAN NOT NULL DEFAULT true,
  orden          INTEGER NOT NULL DEFAULT 0,
  creado_en      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  actualizado_en TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at     TIMESTAMPTZ
);

-- Seed: las 2 herramientas reales que hoy existen en el frontend (ver
-- PR #187 en VIGIIAP -- las otras 5 del catálogo original eran maquetas sin
-- función real o vaporware y se retiraron del código, no solo de esta tabla).
INSERT INTO herramientas (clave, titulo, descripcion, tag, orden) VALUES
  ('conversor', 'Conversor de Coordenadas', NULL, 'Geodésico', 0),
  ('panel-choco', 'Panel de Análisis Territorial — Chocó Biogeográfico',
   'Titulación colectiva, cuencas, RUNAP, humedales, páramos, ciénagas y población del Chocó Biogeográfico — 8 secciones con gráficas y tablas por departamento.',
   'Reportes', 1);

-- RLS: mismo patrón que admin_permisos_modulo/geovisores -- la API conecta
-- como service_role (bypassa RLS), esto solo bloquea PostgREST directo.
ALTER TABLE herramientas ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role full access" ON herramientas
  TO service_role USING (true) WITH CHECK (true);

-- Permisos por módulo de administradores SIG (ver 038_admin_permisos_modulo.sql):
-- se agrega 'herramientas' al catálogo delegable. El nombre de constraint por
-- defecto de Postgres para un CHECK inline sobre la columna `modulo` es
-- `admin_permisos_modulo_modulo_check` (mismo criterio ya usado en este
-- proyecto para constraints con nombre por defecto, ver 039_categorias_rename_cascade.sql).
ALTER TABLE admin_permisos_modulo DROP CONSTRAINT admin_permisos_modulo_modulo_check;
ALTER TABLE admin_permisos_modulo ADD CONSTRAINT admin_permisos_modulo_modulo_check CHECK (modulo IN (
  'usuarios', 'solicitudes', 'documentos', 'mapas',
  'geovisores', 'conexiones_geoserver', 'categorias',
  'configuracion', 'actividad', 'errores', 'reportes', 'herramientas'
));
