-- 058: audit_log -- resultado, ID de petición, cambios (antes/después) y tipo de recurso.
--
-- resultado:    'exito' (por defecto), 'fallo' (intento fallido) o 'denegado' (acceso sin permiso).
-- request_id:   el X-Request-Id de la petición (ver middlewares/requestId.js), para seguir un
--               evento de punta a punta en los logs del servidor.
-- cambios:      JSONB { campo: { antes, despues } } en las acciones sensibles. Los campos que
--               parecen secretos se guardan como "[oculto]" (ver utils/cambios.js).
-- entidad_tipo: 'usuario', 'geovisor', ... -- completa a entidad_id.
--
-- Todo es opcional: las filas existentes quedan en 'exito' y sin los demás datos.
ALTER TABLE audit_log
  ADD COLUMN IF NOT EXISTS resultado    VARCHAR(10) NOT NULL DEFAULT 'exito',
  ADD COLUMN IF NOT EXISTS request_id   VARCHAR(64),
  ADD COLUMN IF NOT EXISTS cambios      JSONB,
  ADD COLUMN IF NOT EXISTS entidad_tipo VARCHAR(40);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'audit_log_resultado_chk'
  ) THEN
    ALTER TABLE audit_log
      ADD CONSTRAINT audit_log_resultado_chk CHECK (resultado IN ('exito', 'fallo', 'denegado'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_audit_log_resultado  ON audit_log (resultado) WHERE resultado <> 'exito';
CREATE INDEX IF NOT EXISTS idx_audit_log_request_id ON audit_log (request_id) WHERE request_id IS NOT NULL;
