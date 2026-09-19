-- 041: Selección de capas individuales por geovisor + retirar el flag de IA sin uso
--
-- Antes solo se podían elegir workspaces completos (todas sus capas, o
-- ninguna) al armar un geovisor. capas_seleccionadas permite elegir capas
-- sueltas del catálogo en vivo, sin importar de qué workspace/tema vengan --
-- así un mismo geovisor puede combinar, por ejemplo, una capa de hidrología
-- con otra de geología. Vacío = comportamiento legado (todas las capas de
-- workspaces_geoserver, o de toda la conexión si ese campo también está
-- vacío) -- ver capaPermitidaEnGeovisor() en geovisores.service.js.
ALTER TABLE geovisores ADD COLUMN IF NOT EXISTS capas_seleccionadas TEXT[] NOT NULL DEFAULT '{}';

COMMENT ON COLUMN geovisores.capas_seleccionadas IS
  'IDs de capa individuales ("workspace:layername") elegidas del catálogo en vivo -- pueden venir de distintos workspaces. Vacío = usar workspaces_geoserver completos (comportamiento legado).';

-- ia_habilitada nunca tuvo una funcionalidad real detrás (ver
-- docs/PORTAL_GEOVISORES_DISENO.md: el asistente de IA/reportes quedó
-- pendiente) -- era un checkbox persistido que no disparaba nada. Se retira
-- limpio; cuando se construya esa funcionalidad de verdad se vuelve a agregar
-- con su propio diseño.
ALTER TABLE geovisores DROP COLUMN IF EXISTS ia_habilitada;
