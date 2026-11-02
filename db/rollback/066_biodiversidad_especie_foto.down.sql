-- ─────────────────────────────────────────────────────────────────────────────
-- Reversión de 066_biodiversidad_especie_foto.sql
-- ─────────────────────────────────────────────────────────────────────────────
-- Elimina SOLO la tabla agregada por 066. Borra las fotos por especie cargadas (se pueden volver a generar con
-- scripts/biodiversidad/buscar_fotos_especies.mjs). Sin la tabla, la lista de especies de los grupos agregados
-- falla: aplique esta reversión solo junto con el despliegue anterior del código que la lee.
-- No la carga el sistema de migraciones: se ejecuta a mano (psql -f) dentro de una transacción.
-- Después, quite la fila de _migraciones para poder reaplicar 066:
--   DELETE FROM _migraciones WHERE nombre = '066_biodiversidad_especie_foto.sql';

DROP TABLE IF EXISTS biodiversidad.especie_foto;
