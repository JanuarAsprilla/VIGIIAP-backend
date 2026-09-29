-- 053: capas_con_ficha -- qué capas vectoriales de un geovisor tienen el modo
-- "fichas por punto" habilitado (foto/video/descripción curados por feature).
--
-- Subconjunto obligatorio de capas_seleccionadas -- reforzado con un CHECK de
-- contención de arreglos (<@) para que ni un UPDATE parcial pueda dejarlo
-- inconsistente. El frontend (VIGIIAP, GeovisorFormBody.tsx) ya filtra a un
-- subconjunto antes de enviar -- esto es la segunda línea de defensa, no la
-- única.
ALTER TABLE geovisores ADD COLUMN IF NOT EXISTS capas_con_ficha TEXT[] NOT NULL DEFAULT '{}';

ALTER TABLE geovisores ADD CONSTRAINT geovisores_capas_con_ficha_subset_check
  CHECK (capas_con_ficha <@ capas_seleccionadas);

COMMENT ON COLUMN geovisores.capas_con_ficha IS
  'IDs de capa ("workspace:layername") con el modo "fichas por punto" habilitado -- cada punto/polígono de estas capas debe tener descripción + al menos un medio antes de que el geovisor pueda publicarse con esa capa en este modo. Ver capas_fichas_config (migración 054) para la configuración de identificador/etiqueta, compartida entre todos los geovisores que usen la misma capa.';
