-- Reversión de 074_conexiones_geoserver_capas_nuevas_auto.sql.
-- No la carga el sistema de migraciones: se ejecuta a mano (psql -f). Después, quite la fila de _migraciones:
--   DELETE FROM _migraciones WHERE nombre = '074_conexiones_geoserver_capas_nuevas_auto.sql';
ALTER TABLE conexiones_geoserver DROP COLUMN IF EXISTS capas_nuevas_auto;
