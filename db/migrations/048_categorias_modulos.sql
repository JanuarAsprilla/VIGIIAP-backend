-- Módulos a los que pertenece cada categoría. Antes se infería del uso real
-- (conteo > 0 en documentos/mapas/geovisores, ver getAll en categorias.service.js),
-- lo que significa que una categoría recién creada -- sin ningún documento,
-- mapa o geovisor todavía -- nunca aparecía como opción seleccionable en
-- ningún formulario (problema de huevo y gallina). Ahora se declara
-- explícitamente al crear la categoría.
--
-- Default '{documentos,mapas,geovisores}' para las categorías ya existentes:
-- preserva su comportamiento actual (visibles en los tres formularios) en
-- vez de que desaparezcan de golpe al desplegar esta migración.
ALTER TABLE categorias ADD COLUMN IF NOT EXISTS modulos TEXT[] NOT NULL DEFAULT '{documentos,mapas,geovisores}';

ALTER TABLE categorias ADD CONSTRAINT categorias_modulos_check
  CHECK (modulos <@ ARRAY['documentos','mapas','geovisores']::text[] AND array_length(modulos, 1) > 0);
