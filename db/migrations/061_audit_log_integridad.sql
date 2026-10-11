-- Integridad del registro de auditoría (Actividad, fase 3).
-- Cada evento queda encadenado al anterior con un hash SHA-256: editar o quitar un evento del
-- medio rompe la cadena y la verificación (src/modules/admin/integridadAuditoria.js) lo detecta.
-- Además la tabla pasa a ser de solo anexado: no admite UPDATE ni DELETE, salvo la purga por
-- retención (src/utils/retencionAuditoria.js), que activa app.purga_auditoria dentro de su
-- transacción, y desvincular al usuario cuando se elimina su cuenta (ON DELETE SET NULL).
-- Es evidencia de manipulación, no una barrera absoluta: quien tenga control total de la base
-- podría recalcular la cadena entera.
ALTER TABLE audit_log
  ADD COLUMN secuencia   BIGINT,
  ADD COLUMN hash_previo TEXT,
  ADD COLUMN hash        TEXT;

-- Hash del contenido del evento y del hash previo. jsonb_build_array evita ambigüedades entre
-- campos. usuario_id queda fuera a propósito: puede pasar a NULL al borrar la cuenta y el correo
-- ya conserva a quién pertenecía.
CREATE OR REPLACE FUNCTION audit_log_calcular_hash(r audit_log) RETURNS TEXT
LANGUAGE sql STABLE AS $$
  SELECT encode(sha256(convert_to(jsonb_build_array(
    r.secuencia, r.hash_previo, r.accion, r.modulo, r.entidad_id, r.descripcion,
    r.usuario_email, r.ip, r.user_agent, r.resultado, r.request_id, r.cambios, r.entidad_tipo,
    to_char(r.creado_en AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US')
  )::text, 'UTF8')), 'hex')
$$;

-- Encadena los eventos que ya existían, del más antiguo al más reciente.
DO $$
DECLARE
  fila audit_log;
  previo TEXT := NULL;
  n BIGINT := 0;
BEGIN
  FOR fila IN SELECT * FROM audit_log ORDER BY creado_en, id LOOP
    n := n + 1;
    fila.secuencia := n;
    fila.hash_previo := previo;
    fila.hash := audit_log_calcular_hash(fila);
    UPDATE audit_log SET secuencia = fila.secuencia, hash_previo = fila.hash_previo, hash = fila.hash WHERE id = fila.id;
    previo := fila.hash;
  END LOOP;
END $$;

CREATE UNIQUE INDEX idx_audit_log_secuencia ON audit_log (secuencia) WHERE secuencia IS NOT NULL;

-- Eventos nuevos: toman el siguiente número y el hash del último, de a uno por vez.
CREATE OR REPLACE FUNCTION audit_log_encadenar() RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  ultima RECORD;
BEGIN
  PERFORM pg_advisory_xact_lock(7391001);
  SELECT secuencia, hash INTO ultima
    FROM audit_log WHERE secuencia IS NOT NULL ORDER BY secuencia DESC LIMIT 1;
  NEW.secuencia := COALESCE(ultima.secuencia, 0) + 1;
  NEW.hash_previo := ultima.hash;
  NEW.hash := audit_log_calcular_hash(NEW);
  RETURN NEW;
END $$;

CREATE TRIGGER trg_audit_log_encadenar
  BEFORE INSERT ON audit_log
  FOR EACH ROW EXECUTE FUNCTION audit_log_encadenar();

CREATE OR REPLACE FUNCTION audit_log_proteger() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF current_setting('app.purga_auditoria', true) = 'on' THEN
      RETURN OLD;
    END IF;
    RAISE EXCEPTION 'audit_log es de solo anexado: no se pueden borrar eventos' USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF NEW.usuario_id IS NULL AND (to_jsonb(NEW) - 'usuario_id') = (to_jsonb(OLD) - 'usuario_id') THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'audit_log es de solo anexado: no se pueden modificar eventos' USING ERRCODE = 'insufficient_privilege';
END $$;

CREATE TRIGGER trg_audit_log_proteger
  BEFORE UPDATE OR DELETE ON audit_log
  FOR EACH ROW EXECUTE FUNCTION audit_log_proteger();
