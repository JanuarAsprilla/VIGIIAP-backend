-- ─────────────────────────────────────────────────────────────────────────────
-- VIGIIAP — Permisos por módulo para administradores SIG
-- ─────────────────────────────────────────────────────────────────────────────
-- El super_admin puede habilitar/deshabilitar módulos del panel por cada
-- admin_sig (funciones diferenciadas: un admin de contenido no necesariamente
-- gestiona usuarios ni configuración). super_admin nunca pasa por esta tabla
-- -- tiene acceso total hardcodeado (ver src/modules/admin/modulos.service.js)
-- para que nadie pueda auto-restringir la única cuenta con control total.
--
-- El catálogo de módulos es fijo y pequeño -- se modela como CHECK enum,
-- mismo patrón que mapas.visibilidad/geovisores.visibilidad, en vez de una
-- tabla catálogo separada que no aportaría nada hoy (YAGNI).
CREATE TABLE admin_permisos_modulo (
  usuario_id     UUID NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  modulo         TEXT NOT NULL CHECK (modulo IN (
                    'usuarios', 'solicitudes', 'documentos', 'mapas',
                    'geovisores', 'conexiones_geoserver', 'categorias',
                    'configuracion', 'actividad', 'errores', 'reportes'
                  )),
  puede_ver      BOOLEAN NOT NULL DEFAULT false,
  puede_editar   BOOLEAN NOT NULL DEFAULT false CHECK (NOT (puede_editar AND NOT puede_ver)),
  creado_en      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  actualizado_en TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (usuario_id, modulo)
);

-- RLS: mismo patrón que 030_rls_missing_tables.sql / 037_geovisores.sql — la
-- API conecta como service_role (bypassa RLS), esto solo bloquea PostgREST.
ALTER TABLE admin_permisos_modulo ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role full access" ON admin_permisos_modulo
  TO service_role USING (true) WITH CHECK (true);
