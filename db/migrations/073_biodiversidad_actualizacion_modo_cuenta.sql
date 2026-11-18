-- 073: el modo «cuenta» de la actualización de biodiversidad siempre tiene a quién usar.
-- Borrar al usuario designado dejaba credencial_usuario_id en NULL (ON DELETE SET NULL) con el modo «cuenta» activo:
-- el proceso aislado quedaba sin credencial. Ahora esa transición vuelve el modo a «publico» y un CHECK lo garantiza.
-- Idempotente. Reversión: db/rollback/073_biodiversidad_actualizacion_modo_cuenta.down.sql.

UPDATE bio_actualizacion_ajustes SET modo = 'publico' WHERE modo = 'cuenta' AND credencial_usuario_id IS NULL;

CREATE OR REPLACE FUNCTION bio_actualizacion_modo_sin_responsable() RETURNS trigger AS $$
BEGIN
  IF NEW.modo = 'cuenta' AND NEW.credencial_usuario_id IS NULL THEN
    NEW.modo := 'publico';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS bio_actualizacion_modo_sin_responsable ON bio_actualizacion_ajustes;
CREATE TRIGGER bio_actualizacion_modo_sin_responsable
  BEFORE UPDATE OF credencial_usuario_id ON bio_actualizacion_ajustes
  FOR EACH ROW EXECUTE FUNCTION bio_actualizacion_modo_sin_responsable();

ALTER TABLE bio_actualizacion_ajustes DROP CONSTRAINT IF EXISTS bio_actualizacion_cuenta_con_responsable;
ALTER TABLE bio_actualizacion_ajustes
  ADD CONSTRAINT bio_actualizacion_cuenta_con_responsable CHECK (modo <> 'cuenta' OR credencial_usuario_id IS NOT NULL);
