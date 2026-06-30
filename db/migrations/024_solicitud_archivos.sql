-- Tabla de archivos adjuntos a solicitudes.
-- Permite a usuarios y administradores adjuntar documentos de soporte.

CREATE TABLE solicitud_archivos (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  solicitud_id UUID NOT NULL REFERENCES solicitudes(id) ON DELETE CASCADE,
  nombre       TEXT NOT NULL,
  archivo_url  TEXT NOT NULL,
  tamano_bytes BIGINT NOT NULL DEFAULT 0,
  mime_type    TEXT NOT NULL DEFAULT 'application/octet-stream',
  subido_por   UUID REFERENCES usuarios(id) ON DELETE SET NULL,
  creado_en    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_solicitud_archivos_solicitud_id ON solicitud_archivos(solicitud_id);

COMMENT ON TABLE solicitud_archivos IS
  'Archivos adjuntos por usuarios o admins a una solicitud. Almacenados en R2.';
