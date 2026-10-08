-- 057: capas_geoserver_vistas -- cuándo vio esta plataforma por primera vez cada capa de GeoServer.
--
-- GeoServer no expone la fecha de publicación de una capa (WFS/WCS GetCapabilities no la trae), y
-- el catálogo se descubre en vivo sin guardar capas (ver 037). Para poder marcar "Nueva" una capa
-- recién publicada, se registra solo su id y la primera vez que apareció en el descubrimiento --
-- no se copia ningún dato de la capa.
--
-- es_linea_base: las capas que ya existían cuando se vio esta conexión por primera vez se marcan
-- como línea base y NUNCA cuentan como nuevas (si no, el día del despliegue todo el catálogo
-- aparecería como "Nueva").
CREATE TABLE IF NOT EXISTS capas_geoserver_vistas (
  conexion_id        UUID        NOT NULL REFERENCES conexiones_geoserver(id) ON DELETE CASCADE,
  capa_id            TEXT        NOT NULL,
  primera_vez_vista  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  es_linea_base      BOOLEAN     NOT NULL DEFAULT false,
  PRIMARY KEY (conexion_id, capa_id)
);

COMMENT ON TABLE capas_geoserver_vistas IS
  'Primera aparición de cada capa de GeoServer por conexión, para marcar capas nuevas en el visor. Solo ids y fechas, nunca datos de la capa.';
