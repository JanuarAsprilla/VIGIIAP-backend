-- 056: incluir_capas_nuevas -- el geovisor muestra automáticamente las capas nuevas que se
-- publiquen en GeoServer dentro de los temas (workspaces) que ya usa.
--
-- capas_seleccionadas es una lista fija guardada al editar el geovisor: una capa publicada
-- después en GeoServer nunca entra a esa lista y el catálogo la filtraba aunque la descubriera.
-- Con este flag activo, además de las capas elegidas se admite cualquier capa de los mismos
-- workspaces. DEFAULT false: los geovisores existentes conservan su curaduría exacta hasta que
-- un admin lo active. La exclusión fija de comunidades étnicas (WORKSPACES_SIEMPRE_EXCLUIDOS en
-- geovisores.service.js) sigue aplicándose por encima de este flag.
ALTER TABLE geovisores ADD COLUMN IF NOT EXISTS incluir_capas_nuevas BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN geovisores.incluir_capas_nuevas IS
  'true = además de capas_seleccionadas, se admiten las capas nuevas de los mismos workspaces (temas) publicadas en GeoServer. No salta WORKSPACES_SIEMPRE_EXCLUIDOS.';
