-- ─────────────────────────────────────────────────────────────────────────────
-- Reversión de 064_biodiversidad_detalle.sql
-- ─────────────────────────────────────────────────────────────────────────────
-- Restaura la vista `vw_registro_publico` de 062 y elimina SOLO lo agregado por 064
-- (vw_especie_conservacion y registro_detalle). Borra los detalles cargados: haga respaldo antes.
-- No la carga el sistema de migraciones: se ejecuta a mano (psql -f) dentro de una transacción.
-- Después, quite la fila de _migraciones para poder reaplicar 064:
--   DELETE FROM _migraciones WHERE nombre = '064_biodiversidad_detalle.sql';

DROP VIEW IF EXISTS biodiversidad.vw_especie_conservacion;
DROP VIEW IF EXISTS biodiversidad.vw_registro_publico;

CREATE VIEW biodiversidad.vw_registro_publico AS
  SELECT r.lote_id, l.grupo, r.gbif_id, r.dataset_key, r.taxon_huella,
         t.especie_clave, t.especie, r.anio, r.fecha_evento, r.tipo_evidencia, r.licencia,
         CASE WHEN x.oculta THEN NULL ELSE r.latitud         END AS latitud,
         CASE WHEN x.oculta THEN NULL ELSE r.longitud        END AS longitud,
         CASE WHEN x.oculta THEN NULL ELSE r.incertidumbre_m END AS incertidumbre_m,
         x.oculta AS coordenadas_ocultas
    FROM biodiversidad.registro r
    JOIN biodiversidad.lote l ON l.id = r.lote_id AND l.activo AND l.estado = 'completo'
    LEFT JOIN biodiversidad.taxon_version t ON t.huella = r.taxon_huella
   CROSS JOIN LATERAL (
     SELECT (
       NOT EXISTS (SELECT 1 FROM biodiversidad.conservacion_importacion WHERE activo)
       OR t.especie_clave IS NULL
       OR EXISTS (SELECT 1 FROM biodiversidad.vw_taxon_amenazado z
                   WHERE z.clasificacion_clave = t.clasificacion_clave
                     AND z.especie_clave = t.especie_clave)
     ) AS oculta
   ) x;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'biodiversidad_ingesta') THEN
    GRANT SELECT ON biodiversidad.vw_registro_publico TO biodiversidad_ingesta;
  END IF;
END $$;

DROP TABLE IF EXISTS biodiversidad.registro_detalle;
