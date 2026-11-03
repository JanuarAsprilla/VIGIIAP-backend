-- ─────────────────────────────────────────────────────────────────────────────
-- Reversión de 067_biodiversidad_actualizacion.sql
-- ─────────────────────────────────────────────────────────────────────────────
-- Elimina SOLO las tres tablas agregadas por 067: los ajustes, las credenciales cifradas de GBIF y la bitácora
-- de ejecuciones. No afecta a los datos de biodiversidad. Aplique esta reversión solo junto con el despliegue anterior.
-- No la carga el sistema de migraciones: se ejecuta a mano (psql -f) dentro de una transacción.
-- Después, quite la fila de _migraciones para poder reaplicar 067:
--   DELETE FROM _migraciones WHERE nombre = '067_biodiversidad_actualizacion.sql';

DROP TABLE IF EXISTS bio_actualizacion_ejecuciones;
DROP TABLE IF EXISTS bio_actualizacion_credenciales;
DROP TABLE IF EXISTS bio_actualizacion_ajustes;
