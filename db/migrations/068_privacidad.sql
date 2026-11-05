-- 068: Privacidad (Ley 1581 de 2012)
--  1. consentimientos: prueba de la autorización (quién, qué texto —versión—, cuándo, desde dónde).
--  2. usuarios.eliminado_en: marca las cuentas anonimizadas a pedido del titular.
--  3. Las claves foráneas hacia usuarios que no definían ON DELETE (geovisores.creado_por, fichas_punto, …)
--     bloqueaban el borrado de cualquier administrador que hubiera creado contenido; pasan a SET NULL.

CREATE TABLE IF NOT EXISTS consentimientos (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  usuario_id       UUID        REFERENCES usuarios(id) ON DELETE SET NULL,
  tipo             TEXT        NOT NULL
                               CHECK (tipo IN ('tratamiento_datos', 'terminos', 'analitica_persistente', 'datos_sensibles')),
  version_politica TEXT        NOT NULL CHECK (char_length(version_politica) <= 40),
  origen           TEXT        NOT NULL
                               CHECK (origen IN ('registro', 'oauth', 'visitante', 'perfil', 'banner')),
  aceptado         BOOLEAN     NOT NULL DEFAULT true,
  ip               INET,
  user_agent       TEXT        CHECK (user_agent IS NULL OR char_length(user_agent) <= 300),
  creado_en        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_consentimientos_usuario ON consentimientos (usuario_id, tipo, creado_en DESC);

COMMENT ON TABLE consentimientos IS
  'Prueba de la autorización del titular (Ley 1581, art. 9; Decreto 1074/2015). Una fila por aceptación o revocación; no se actualiza.';

ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS eliminado_en TIMESTAMPTZ;

DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT c.conrelid::regclass AS tabla, c.conname AS restriccion, a.attname AS columna
    FROM pg_constraint c
    JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = c.conkey[1]
    WHERE c.contype = 'f'
      AND c.confrelid = 'usuarios'::regclass
      AND c.confdeltype = 'a'          -- NO ACTION: el valor por omisión cuando no se declaró ON DELETE
      AND array_length(c.conkey, 1) = 1
      AND NOT a.attnotnull
  LOOP
    EXECUTE format('ALTER TABLE %s DROP CONSTRAINT %I', r.tabla, r.restriccion);
    EXECUTE format(
      'ALTER TABLE %s ADD CONSTRAINT %I FOREIGN KEY (%I) REFERENCES usuarios(id) ON DELETE SET NULL',
      r.tabla, r.restriccion, r.columna
    );
  END LOOP;
END $$;
