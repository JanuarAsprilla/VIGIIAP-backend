-- ─────────────────────────────────────────────────────────────────────────────
-- VIGIIAP — Biodiversidad: detalle de registros y conservación por especie (API v2)
-- ─────────────────────────────────────────────────────────────────────────────
-- Solo agrega: la tabla `registro_detalle` (observador, identificador y fotos de cada registro),
-- columnas AL FINAL de `vw_registro_publico` y la vista `vw_especie_conservacion`. No altera ni
-- borra datos. Reversión: db/rollback/064_biodiversidad_detalle.down.sql.
--
-- Seguridad (mismo criterio que 062): RLS activo, sin acceso para PUBLIC/anon/authenticated, el rol
-- `biodiversidad_ingesta` es el único que escribe. La vista pública sigue ocultando las
-- coordenadas de especies amenazadas y falla cerrado sin cruce de conservación activo.
-- La migración es idempotente.

-- ─── 1. Detalle por registro ──────────────────────────────────────────────────
-- Las fotos son referencias a la caché de imágenes de GBIF (nunca la URL original del autor); la
-- API vuelve a validarlas antes de entregarlas.
CREATE TABLE IF NOT EXISTS biodiversidad.registro_detalle (
  lote_id          BIGINT NOT NULL,
  gbif_id          TEXT NOT NULL,
  registrado_por   TEXT,
  identificado_por TEXT,
  fotos            JSONB NOT NULL DEFAULT '[]' CHECK (jsonb_typeof(fotos) = 'array'),
  PRIMARY KEY (lote_id, gbif_id),
  FOREIGN KEY (lote_id, gbif_id) REFERENCES biodiversidad.registro(lote_id, gbif_id)
);

-- ─── 2. Vista pública ampliada (columnas nuevas SIEMPRE al final) ─────────────
CREATE OR REPLACE VIEW biodiversidad.vw_registro_publico AS
  SELECT r.lote_id, l.grupo, r.gbif_id, r.dataset_key, r.taxon_huella,
         t.especie_clave, t.especie, r.anio, r.fecha_evento, r.tipo_evidencia, r.licencia,
         CASE WHEN x.oculta THEN NULL ELSE r.latitud         END AS latitud,
         CASE WHEN x.oculta THEN NULL ELSE r.longitud        END AS longitud,
         CASE WHEN x.oculta THEN NULL ELSE r.incertidumbre_m END AS incertidumbre_m,
         x.oculta AS coordenadas_ocultas,
         d.registrado_por, d.identificado_por, COALESCE(d.fotos, '[]'::jsonb) AS fotos,
         r.marcas_revision, r.institution_code, r.collection_code, r.catalog_number,
         r.occurrence_id, r.nombre_original
    FROM biodiversidad.registro r
    JOIN biodiversidad.lote l ON l.id = r.lote_id AND l.activo AND l.estado = 'completo'
    LEFT JOIN biodiversidad.taxon_version t ON t.huella = r.taxon_huella
    LEFT JOIN biodiversidad.registro_detalle d ON d.lote_id = r.lote_id AND d.gbif_id = r.gbif_id
   CROSS JOIN LATERAL (
     SELECT (
       NOT EXISTS (SELECT 1 FROM biodiversidad.conservacion_importacion WHERE activo)
       OR t.especie_clave IS NULL
       OR EXISTS (SELECT 1 FROM biodiversidad.vw_taxon_amenazado z
                   WHERE z.clasificacion_clave = t.clasificacion_clave
                     AND z.especie_clave = t.especie_clave)
     ) AS oculta
   ) x;

-- ─── 3. Conservación por especie (cruce ACTIVO) ───────────────────────────────
-- amenaza_orden: 1 = CR, 2 = EN, 3 = VU (la más severa de la especie); NULL si no está amenazada.
CREATE OR REPLACE VIEW biodiversidad.vw_especie_conservacion AS
  SELECT v.clasificacion_clave, v.especie_clave,
         MIN(CASE WHEN a.tema = 'amenaza_nacional'
                  THEN CASE a.valor WHEN 'CR' THEN 1 WHEN 'EN' THEN 2 WHEN 'VU' THEN 3 END
             END)::smallint AS amenaza_orden,
         COALESCE(bool_or(a.tema = 'endemismo_colombia'), false)        AS endemica_colombia,
         COALESCE(bool_or(a.tema = 'endemismo_choco_reportado'), false) AS endemica_choco,
         COALESCE(bool_or(a.tema = 'introducida'), false)               AS introducida,
         COALESCE(bool_or(a.tema = 'invasora_declarada'), false)        AS invasora
    FROM biodiversidad.conservacion_vinculo v
    JOIN biodiversidad.conservacion_afirmacion a ON a.id = v.afirmacion_id
    JOIN biodiversidad.conservacion_importacion i ON i.id = a.importacion_id AND i.activo
   GROUP BY v.clasificacion_clave, v.especie_clave;

-- ─── 4. Permisos (replica el patrón de 062 para los objetos nuevos) ───────────
REVOKE ALL ON biodiversidad.registro_detalle, biodiversidad.vw_especie_conservacion FROM PUBLIC;

DO $$
DECLARE
  rol TEXT;
BEGIN
  FOREACH rol IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = rol) THEN
      EXECUTE format('REVOKE ALL ON biodiversidad.registro_detalle, biodiversidad.vw_especie_conservacion FROM %I', rol);
    END IF;
  END LOOP;

  ALTER TABLE biodiversidad.registro_detalle ENABLE ROW LEVEL SECURITY;

  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'biodiversidad_ingesta') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON biodiversidad.registro_detalle TO biodiversidad_ingesta;
    DROP POLICY IF EXISTS ingesta_acceso_total ON biodiversidad.registro_detalle;
    CREATE POLICY ingesta_acceso_total ON biodiversidad.registro_detalle TO biodiversidad_ingesta USING (true) WITH CHECK (true);
    GRANT SELECT ON biodiversidad.vw_registro_publico, biodiversidad.vw_especie_conservacion TO biodiversidad_ingesta;
  END IF;
END $$;
