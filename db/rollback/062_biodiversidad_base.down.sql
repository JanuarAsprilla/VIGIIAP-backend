-- ─────────────────────────────────────────────────────────────────────────────
-- Reversión de 062_biodiversidad_base.sql
-- ─────────────────────────────────────────────────────────────────────────────
-- Elimina SOLO el esquema `biodiversidad` y su rol de ingesta. No toca ninguna otra tabla.
-- DESTRUCTIVO: borra todos los datos de biodiversidad cargados. Haga respaldo antes.
-- No la carga el sistema de migraciones: se ejecuta a mano (psql -f) dentro de una transacción.
-- Después, quite también la fila de _migraciones para poder reaplicar 062:
--   DELETE FROM _migraciones WHERE nombre = '062_biodiversidad_base.sql';

DROP SCHEMA IF EXISTS biodiversidad CASCADE;
DROP ROLE IF EXISTS biodiversidad_ingesta;
