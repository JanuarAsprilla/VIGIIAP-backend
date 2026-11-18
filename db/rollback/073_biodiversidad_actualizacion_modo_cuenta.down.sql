-- Reversión de 073_biodiversidad_actualizacion_modo_cuenta.sql: quita el CHECK y el trigger. No revierte los ajustes ya normalizados.
-- No la carga el sistema de migraciones: se ejecuta a mano (psql -f). Después, quite la fila de _migraciones:
--   DELETE FROM _migraciones WHERE nombre = '073_biodiversidad_actualizacion_modo_cuenta.sql';
ALTER TABLE bio_actualizacion_ajustes DROP CONSTRAINT IF EXISTS bio_actualizacion_cuenta_con_responsable;
DROP TRIGGER IF EXISTS bio_actualizacion_modo_sin_responsable ON bio_actualizacion_ajustes;
DROP FUNCTION IF EXISTS bio_actualizacion_modo_sin_responsable();
