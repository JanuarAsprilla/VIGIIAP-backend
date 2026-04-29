-- Tabla de categorías de documentos con soporte para thumbnail de portada.
-- El nombre es la clave primaria porque coincide con el campo `tipo` en documentos.
CREATE TABLE IF NOT EXISTS categorias (
  nombre         TEXT PRIMARY KEY,
  thumbnail_url  TEXT,
  actualizado_en TIMESTAMPTZ DEFAULT NOW()
);

-- Insertar las categorías base (sin thumbnail — se suben desde el panel admin)
INSERT INTO categorias (nombre) VALUES
  ('Cartografía'),
  ('Estudios Ambientales'),
  ('Normativa'),
  ('Informes Técnicos'),
  ('Biodiversidad'),
  ('Hidrología'),
  ('Protocolos Ambientales'),
  ('Bibliografía Técnica'),
  ('Análisis de Tendencias'),
  ('Formatos y Plantillas')
ON CONFLICT (nombre) DO NOTHING;
