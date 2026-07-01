-- 024: Archivos adjuntos para solicitudes
-- Permite a los solicitantes adjuntar documentación de soporte (PDF, imágenes)
-- que los administradores pueden revisar y descargar para procesar el trámite.
-- Los archivos se almacenan en R2 (bucket privado) y se sirven via URL prefirmada.

CREATE TABLE IF NOT EXISTS solicitud_archivos (
  id           UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  solicitud_id UUID        NOT NULL REFERENCES solicitudes(id) ON DELETE CASCADE,
  nombre       TEXT        NOT NULL,
  url          TEXT        NOT NULL,
  mime_type    TEXT        NOT NULL,
  tamano_bytes INTEGER,
  subido_por   UUID        REFERENCES usuarios(id) ON DELETE SET NULL,
  creado_en    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sol_archivos_solicitud ON solicitud_archivos(solicitud_id);

COMMENT ON TABLE solicitud_archivos IS
  'Archivos de soporte adjuntados a una solicitud de trámite';
COMMENT ON COLUMN solicitud_archivos.url IS
  'URL R2 del archivo — acceso solo via URL prefirmada (bucket privado)';
