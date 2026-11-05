-- 069: Derechos del titular sobre su cuenta (Ley 1581 de 2012)
--  1. usuarios.eliminado_en: marca las cuentas anonimizadas a pedido del titular.
--  2. Las claves foráneas hacia usuarios que no definían ON DELETE (geovisores.creado_por, fichas_punto, ...)
--     bloqueaban el borrado de cualquier administrador que hubiera creado contenido; pasan a SET NULL.

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
