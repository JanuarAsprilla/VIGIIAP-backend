-- Reversión de 075_geoserver_inventario.sql.
-- No la carga el sistema de migraciones: se ejecuta a mano (psql -f). Después, quite la fila de _migraciones:
--   DELETE FROM _migraciones WHERE nombre = '075_geoserver_inventario.sql';
DROP TABLE IF EXISTS geoserver_sincronizaciones;
DROP TABLE IF EXISTS geoserver_inventario_estilos;
DROP TABLE IF EXISTS geoserver_inventario_grupos;
DROP TABLE IF EXISTS geoserver_inventario_capas;
DROP TABLE IF EXISTS geoserver_inventario_espacios;
